export * as HamzadGateway from "./gateway.js"

// What Hamzad's API says on the wire: the model list, the device sign-in and the balance.
// Everything read from the network is decoded here, once; the rest of the plugin gets typed values.

import { Duration, Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { HamzadStatus } from "@opencode/util/hamzad-status"

export const clientID = "hamzad-cli"

const maybe = <const S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

export const Model = Schema.Struct({
  id: Schema.String,
  name: maybe(Schema.String),
  family: maybe(Schema.String),
  released: maybe(Schema.String),
  context_window: maybe(Schema.Number),
  max_output_tokens: maybe(Schema.Number),
  capabilities: maybe(
    Schema.Struct({
      tools: maybe(Schema.Boolean),
      images: maybe(Schema.Boolean),
      reasoning: maybe(Schema.Boolean),
    }),
  ),
  reasoning_efforts: maybe(Schema.Array(Schema.String)),
  // Which prompt-cache markers the model's route accepts, when it accepts any.
  cache_format: maybe(Schema.Literals(["anthropic", "alibaba"])),
  // Credits per million tokens.
  pricing: maybe(
    Schema.Struct({
      input: maybe(Schema.Number),
      output: maybe(Schema.Number),
      cache_read: maybe(Schema.Number),
      cache_write: maybe(Schema.Number),
    }),
  ),
  default: maybe(Schema.Boolean),
  small: maybe(Schema.Boolean),
})
export type Model = typeof Model.Type

export const Models = Schema.Array(Model)

const decodeModel = Schema.decodeUnknownOption(Model)

/**
 * The models on offer, in the gateway's order: with a key, the ones that account may use; without,
 * the ones that need no plan. When there is no list, why: the gateway asks for a key until it
 * serves everyone (401), is on but not for this account (403), or is switched off (404).
 * One malformed entry never discards the rest.
 */
export const models = Effect.fn("HamzadGateway.models")(function* (
  http: HttpClient.HttpClient,
  api: string,
  key: string | undefined,
) {
  const request = HttpClientRequest.get(`${api}/llm/models`).pipe(HttpClientRequest.acceptJson)
  const response = yield* http
    .execute(key ? request.pipe(HttpClientRequest.bearerToken(key)) : request)
    .pipe(Effect.timeout("10 seconds"))
  if (response.status === 401) return { state: key ? ("refused" as const) : ("sign-in" as const) }
  if (response.status === 403) return { state: "no-access" as const }
  if (response.status === 404) return { state: "unavailable" as const }
  const list = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ data: Schema.Array(Schema.Unknown) }))),
  )
  return {
    state: "listed" as const,
    models: list.data.flatMap((raw) => {
      const model = Option.getOrUndefined(decodeModel(raw))
      return model ? [model] : []
    }),
  }
})

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: maybe(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.Number,
})

const Token = Schema.Struct({
  access_token: Schema.String,
  expires_in: maybe(Schema.Number),
  key_id: maybe(Schema.String),
  // Whose account it is, masked by the gateway: enough to tell two sign-ins apart.
  account: maybe(Schema.String),
})
const Pending = Schema.Struct({ error: Schema.String })

const post = (http: HttpClient.HttpClient, url: string, body: Record<string, string>) =>
  HttpClientRequest.post(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.schemaBodyJson(Schema.Record(Schema.String, Schema.String))(body),
    Effect.flatMap((request) => http.execute(request)),
  )

/** A sign-in that could not go on. `reason` is the code the API or the panel gave. */
export class DeviceError extends Schema.TaggedError<DeviceError>()("Hamzad.DeviceError", {
  reason: Schema.String,
}) {
  override get message() {
    return HamzadStatus.signIn(this.reason)
  }
}

// These two routes refuse in the API's own shape, `{ code, message, requestId }`, not the
// gateway's. Whatever went wrong becomes a DeviceError, so a person reads a sentence and never a
// status line or the address of the request.
const Refused = Schema.Struct({ code: Schema.String })

const refusal = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(Refused)(response).pipe(
    Effect.map((body) => body.code),
    Effect.orElseSucceed(() => `status_${response.status}`),
    Effect.flatMap((reason) => Effect.fail(new DeviceError({ reason }))),
  )

const sent = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.mapError((error) => (error instanceof DeviceError ? error : new DeviceError({ reason: "unreachable" }))),
  )

/** Starts a sign-in the person finishes in the panel. `name` is how the device is listed there. */
export const device = Effect.fn("HamzadGateway.device")(function* (
  http: HttpClient.HttpClient,
  api: string,
  name: string,
) {
  return yield* sent(
    post(http, `${api}/auth/device/code`, { client_id: clientID, device_name: name }).pipe(
      Effect.timeout("15 seconds"),
      Effect.flatMap((response) =>
        response.status >= 400
          ? refusal(response)
          : HttpClientResponse.schemaBodyJson(Device)(response).pipe(
              Effect.mapError(() => new DeviceError({ reason: "unreadable" })),
            ),
      ),
    ),
  )
})

/** Waits for the panel's decision and returns the key made for this device. */
export function token(http: HttpClient.HttpClient, api: string, code: string, interval: Duration.Duration) {
  const loop = (wait: Duration.Duration): Effect.Effect<typeof Token.Type, DeviceError> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const response = yield* sent(
        post(http, `${api}/auth/device/token`, {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: code,
          client_id: clientID,
        }).pipe(Effect.timeout("15 seconds")),
      )
      // While it waits, the panel's answer is OAuth's `{ error }`; anything else is a refusal.
      const result = yield* HttpClientResponse.schemaBodyJson(Schema.Union([Token, Pending]))(response).pipe(
        Effect.catch(() => refusal(response)),
      )
      if ("access_token" in result) return result
      if (result.error === "authorization_pending") return yield* loop(wait)
      if (result.error === "slow_down") return yield* loop(Duration.sum(wait, Duration.seconds(5)))
      return yield* new DeviceError({ reason: result.error })
    })
  return loop(interval)
}

const Count = { requests: Schema.Number, credits: Schema.Number }

const Summary = Schema.Struct({
  balance: Schema.Struct({ available: Schema.Number }),
  pendingCredits: maybe(Schema.Number),
  days: maybe(Schema.Number),
  total: maybe(Schema.Struct({ ...Count, promptTokens: Schema.Number, completionTokens: Schema.Number })),
  byDay: maybe(Schema.Array(Schema.Struct({ day: Schema.String, ...Count }))),
  byModel: maybe(
    Schema.Array(
      Schema.Struct({ modelId: Schema.String, ...Count, promptTokens: Schema.Number, completionTokens: Schema.Number }),
    ),
  ),
})
export type Summary = typeof Summary.Type

/** What the account has left and what it used through the gateway over the last 30 days. */
export const summary = Effect.fn("HamzadGateway.summary")(function* (
  http: HttpClient.HttpClient,
  api: string,
  key: string,
) {
  return yield* HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.get(`${api}/llm/usage/summary?days=30`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(key),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Summary)), Effect.timeout("10 seconds"))
})

/**
 * What is left, to the hundredth. The gateway gives it rounded down to a whole credit, beside what
 * was used and is not yet charged. A prompt on a small model costs a few hundredths, so the whole
 * number would stand still for many prompts and read as broken. The fraction it dropped is the one
 * that takes the pending amount up to its next whole credit.
 */
export function left(answer: Pick<Summary, "balance" | "pendingCredits">) {
  const pending = answer.pendingCredits ?? 0
  if (answer.balance.available <= 0) return 0
  // Down to the hundredth, never up: the figure must not promise a hundredth that is not there.
  return Math.floor((answer.balance.available + Math.ceil(pending) - pending) * 100 + 1e-6) / 100
}

/** The gateway counts a day as Tehran's. */
export const today = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

/** What the gateway says when it refuses a request, as far as the plugin reads it. */
export const Refusal = Schema.Struct({
  error: Schema.Struct({
    code: maybe(Schema.String),
    type: maybe(Schema.String),
    message: maybe(Schema.String),
  }),
})
export type Refusal = typeof Refusal.Type
