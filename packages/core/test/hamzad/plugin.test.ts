import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Credential } from "@opencode/core/credential"
import { HamzadModels } from "@opencode/core/hamzad/models"
import { HamzadPlugin } from "@opencode/core/hamzad/plugin"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Session } from "@opencode/core/session"
import { Brand } from "@opencode/util/brand"
import { withEnv } from "../fixture/env"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const key = `sk-hmz-${"a".repeat(43)}`

const sonnet = {
  id: "claude-sonnet",
  object: "model",
  owned_by: "Anthropic",
  name: "Claude Sonnet 5.5",
  family: "claude-sonnet",
  released: "2026-09-01",
  context_window: 200000,
  max_output_tokens: 32000,
  capabilities: { tools: true, images: true, reasoning: true },
  reasoning_efforts: ["low", "medium", "high"],
  cache_format: "anthropic" as const,
  pricing: {
    unit: "credits_per_million_tokens",
    input: 1271.4919,
    output: 6357.4594,
    cache_read: 127.1492,
    cache_write: 1589.3648,
  },
  default: true,
  small: false,
}
const flash = {
  id: "deepseek",
  object: "model",
  name: "DeepSeek V4.1 Flash",
  context_window: 128000,
  max_output_tokens: 16000,
  capabilities: { tools: true, images: false, reasoning: false },
  cache_format: null,
  pricing: { unit: "credits_per_million_tokens", input: 190.7238, output: 762.8951, cache_read: null },
  default: false,
  small: true,
}
// A model that needs a plan: the gateway lists it only for a signed-in account.
const opus = { ...sonnet, id: "claude-opus", name: "Claude Opus 5.5", family: "claude-opus", default: false }

// A stand-in for Hamzad's API. `stage` is whom the gateway serves; `approveAfter` is how many
// times the device poll answers "pending" first.
function gateway(
  input: {
    stage?: "everyone" | "staff" | "off"
    approveAfter?: number
    deny?: boolean
    /** On, but not for the signed-in account. */
    denied?: boolean
    /** How the sign-in routes refuse, in the API's own shape: a status and a code. */
    signIn?: { status: number; code?: string }
  } = {},
) {
  const requests: { path: string; authorization: string | null; body?: unknown }[] = []
  const state = { polls: 0, down: false, balance: 500 }
  const stage = input.stage ?? "everyone"
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const authorization = request.headers.get("authorization")
      const body: unknown = request.method === "POST" ? await request.json() : undefined
      requests.push({ path, authorization, body })
      if (state.down) return new Response("unavailable", { status: 503 })
      if (path.startsWith("/api/v1/auth/device/") && (stage === "off" || input.signIn)) {
        const refusal = input.signIn ?? { status: 404, code: "auth.device_unavailable" }
        return refusal.code
          ? Response.json(
              { code: refusal.code, message: "این امکان در دسترس نیست.", requestId: "req_1" },
              { status: refusal.status },
            )
          : new Response("<html>Bad gateway</html>", { status: refusal.status })
      }
      if (path === "/api/v1/auth/device/code")
        return Response.json({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: `${url.origin}/panel/device`,
          verification_uri_complete: `${url.origin}/panel/device?code=ABCD-EFGH`,
          expires_in: 600,
          interval: 0,
        })
      if (path === "/api/v1/auth/device/token") {
        state.polls++
        if (input.deny) return Response.json({ error: "access_denied" }, { status: 400 })
        if (state.polls <= (input.approveAfter ?? 0))
          return Response.json({ error: "authorization_pending" }, { status: 400 })
        return Response.json({
          access_token: key,
          token_type: "bearer",
          expires_in: 15552000,
          key_id: "key_1",
          base_url: `${url.origin}/api/v1/llm`,
          account: "+98912•••0001",
        })
      }
      if (path === "/api/v1/llm/usage/summary") {
        state.balance -= 3
        return Response.json({
          balance: { credits: state.balance, reserved: 0, available: state.balance },
          pendingCredits: 0,
        })
      }
      if (path === "/api/v1/llm/models") {
        if (stage === "off")
          return Response.json({ error: { code: "not_found", type: "invalid_request_error" } }, { status: 404 })
        const signedIn = authorization === `Bearer ${key}`
        if (!signedIn && (stage !== "everyone" || authorization))
          return Response.json({ error: { code: "invalid_api_key", type: "authentication_error" } }, { status: 401 })
        if (input.denied)
          return Response.json({ error: { code: "access_denied", type: "permission_error" } }, { status: 403 })
        return Response.json({ object: "list", data: signedIn ? [sonnet, flash, opus] : [sonnet, flash] })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, requests, state, api: `${server.url.origin}/api/v1` }
}

const served = <A, E, R>(
  input: Parameters<typeof gateway>[0],
  use: (started: ReturnType<typeof gateway>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => gateway(input)),
    (started) => withEnv({ HAMZAD_API_URL: started.api, HAMZAD_API_KEY: undefined }, () => use(started)),
    (started) => Effect.promise(() => started.server.stop(true)),
  )

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* HamzadPlugin.Plugin.effect(host)
  return host
})

const offered = Effect.gen(function* () {
  const models = yield* Model.Service
  return (yield* models.available())
    .filter((model) => model.providerID === HamzadModels.providerID)
    .map((model) => String(model.id))
    .toSorted()
})

describe.skipIf(!Brand.isHamzad)("HamzadPlugin", () => {
  it.live("offers the device sign-in, a pasted key and the key variable", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const integration = yield* integrations.get(HamzadPlugin.integrationID)
        expect(integration?.name).toBe("Hamzad")
        expect(integration?.methods).toEqual([
          { id: Integration.MethodID.make("device"), type: "oauth", label: "Sign in with Hamzad" },
          { type: "key", label: "Paste a Hamzad API key" },
          { type: "env", names: ["HAMZAD_API_KEY"] },
        ])
      }),
    ),
  )

  it.live("lists the models that need no plan before anyone signs in", () =>
    served({}, (started) =>
      Effect.gen(function* () {
        yield* addPlugin()
        // A first start has nothing saved, so the list is there as soon as the plugin is.
        expect(yield* offered).toEqual(["claude-sonnet", "deepseek"])
        expect(started.requests.filter((request) => request.path.endsWith("/llm/models"))).toEqual([
          { path: "/api/v1/llm/models", authorization: null, body: undefined },
        ])
        const model = yield* Model.Service
        expect((yield* model.default())?.id).toBe(Model.ID.make("claude-sonnet"))
        const providers = yield* Provider.Service
        expect(yield* providers.get(HamzadModels.providerID)).toMatchObject({
          name: "Hamzad",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `${started.api}/llm` },
          headers: { "x-hamzad-cost-unit": "credit" },
        })
      }),
    ),
  )

  const status = Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    return yield* rpc.call("hamzad.status", "get", {})
  })

  it.live("has no list while the gateway is switched off, and knows that is why", () =>
    served({ stage: "off" }, (started) =>
      Effect.gen(function* () {
        yield* addPlugin()
        expect(yield* offered).toEqual([])
        expect(started.requests.filter((request) => request.path.endsWith("/llm/models")).length).toBe(1)
        expect(yield* status).toEqual({ models: "unavailable" })
      }),
    ),
  )

  it.live("has no list before sign-in while the gateway is open to staff only, and knows a sign-in is wanted", () =>
    served({ stage: "staff" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        expect(yield* offered).toEqual([])
        expect(yield* status).toEqual({ models: "sign-in" })
      }),
    ),
  )

  it.live("knows when the gateway is on but not for this account, and when it refuses the key", () =>
    Effect.gen(function* () {
      yield* served({ denied: true }, () =>
        withEnv({ HAMZAD_API_KEY: key }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            expect(yield* offered).toEqual([])
            expect(yield* status).toEqual({ models: "no-access" })
          }),
        ),
      )
    }),
  )

  it.live("knows when the gateway refuses the key it was sent", () =>
    served({}, () =>
      withEnv({ HAMZAD_API_KEY: `sk-hmz-${"x".repeat(43)}` }, () =>
        Effect.gen(function* () {
          yield* addPlugin()
          expect(yield* offered).toEqual([])
          expect(yield* status).toEqual({ models: "refused" })
        }),
      ),
    ),
  )

  it.live("says the list is there once it is", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        expect(yield* status).toEqual({ models: "listed" })
      }),
    ),
  )

  const signInFails = (input: Parameters<typeof gateway>[0]) =>
    served(input, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        return yield* integrations.oauth
          .connect({
            integrationID: HamzadPlugin.integrationID,
            methodID: Integration.MethodID.make("device"),
            answer: {},
          })
          .pipe(
            Effect.flip,
            Effect.map((error) =>
              String(error instanceof Error && error.cause instanceof Error ? error.cause.message : error),
            ),
          )
      }),
    )

  it.live("words a sign-in that cannot start by its code, never as a status line", () =>
    Effect.gen(function* () {
      expect(yield* signInFails({ stage: "off" })).toBe("Hamzad's API for tools is not available yet.")
      expect(yield* signInFails({ signIn: { status: 429, code: "auth.device_attempts" } })).toBe(
        "Too many sign-in attempts. Try again in a little while.",
      )
      expect(yield* signInFails({ signIn: { status: 409, code: "keys.too_many" } })).toBe(
        "This account already has as many keys as it may. Revoke one in the Hamzad panel, then sign in again.",
      )
      // Anything it has no words for, and an answer that is not the API's at all.
      expect(yield* signInFails({ signIn: { status: 500, code: "internal" } })).toBe(
        "Hamzad could not complete the sign-in. Try again in a little while.",
      )
      expect(yield* signInFails({ signIn: { status: 502 } })).toBe(
        "Hamzad could not complete the sign-in. Try again in a little while.",
      )
    }),
  )

  it.live("signs in by approving the device, is labelled with the account, and lists what the account may use", () =>
    served({ approveAfter: 2 }, (started) =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: HamzadPlugin.integrationID,
          methodID: Integration.MethodID.make("device"),
          answer: {},
        })
        expect(attempt.url).toBe(`${started.server.url.origin}/panel/device?code=ABCD-EFGH`)
        expect(attempt.instructions).toBe("Enter code: ABCD-EFGH")
        yield* eventually(
          integrations.oauth.status({ integrationID: HamzadPlugin.integrationID, attemptID: attempt.attemptID }),
          (status) => status.status === "complete",
        )

        const code = started.requests.find((request) => request.path.endsWith("/auth/device/code"))
        expect(code?.body).toMatchObject({ client_id: "hamzad-cli" })
        expect(started.state.polls).toBe(3)
        const credentials = yield* Credential.Service
        const saved = (yield* credentials.list(HamzadPlugin.integrationID))[0]
        expect(saved?.label).toBe("+98912•••0001")
        expect(saved?.value).toEqual(
          Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("device"),
            access: key,
            refresh: "",
            expires: 0,
            metadata: { server: started.api, keyID: "key_1", account: "+98912•••0001" },
          }),
        )

        // Signing in asks again, now with the key, and the models that need a plan appear.
        expect(yield* eventually(offered, (models) => models.length === 3)).toEqual([
          "claude-opus",
          "claude-sonnet",
          "deepseek",
        ])
      }),
    ),
  )

  it.live("reports a declined sign-in", () =>
    served({ deny: true }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: HamzadPlugin.integrationID,
          methodID: Integration.MethodID.make("device"),
          answer: {},
        })
        const status = yield* eventually(
          integrations.oauth.status({ integrationID: HamzadPlugin.integrationID, attemptID: attempt.attemptID }),
          (status) => status.status !== "pending",
        )
        expect(status.status).toBe("failed")
        const credentials = yield* Credential.Service
        expect(yield* credentials.list(HamzadPlugin.integrationID)).toEqual([])
      }),
    ),
  )

  it.live("uses the key variable and keeps the last list for a start with no network", () =>
    served({}, (started) =>
      withEnv({ HAMZAD_API_KEY: key }, () =>
        Effect.gen(function* () {
          const host = yield* addPlugin()
          expect(yield* offered).toEqual(["claude-opus", "claude-sonnet", "deepseek"])
          expect(started.requests.at(-1)).toMatchObject({ path: "/api/v1/llm/models", authorization: `Bearer ${key}` })
          expect(yield* host.storage.get("models")).toMatchObject({
            api: started.api,
            models: [{ id: "claude-sonnet" }, { id: "deepseek" }, { id: "claude-opus" }],
          })

          // A later start shows what the earlier one saved without waiting for the gateway.
          started.state.down = true
          const plugin = yield* Plugin.Service
          const second = yield* PluginHost.make(plugin, "test")
          yield* second.storage.set("models", { api: started.api, models: [{ id: "kept-model", name: "Kept" }] })
          yield* HamzadPlugin.Plugin.effect(second)
          const models = yield* Model.Service
          expect((yield* models.all()).some((model) => model.id === Model.ID.make("kept-model"))).toBe(true)
        }),
      ),
    ),
  )

  it.live("uses the key from the environment ahead of a stored sign-in", () =>
    served({}, (started) =>
      Effect.gen(function* () {
        // A sign-in the gateway no longer accepts, such as a device revoked in the panel.
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: HamzadPlugin.integrationID,
          label: "+98912•••0001",
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("device"),
            access: `sk-hmz-${"r".repeat(43)}`,
            refresh: "",
            expires: 0,
          }),
        })
        yield* withEnv({ HAMZAD_API_KEY: key }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const integrations = yield* Integration.Service
            expect(yield* integrations.connection.active(HamzadPlugin.integrationID)).toEqual({
              type: "env",
              name: "HAMZAD_API_KEY",
            })
            expect((yield* integrations.get(HamzadPlugin.integrationID))?.connections).toMatchObject([
              { type: "env", name: "HAMZAD_API_KEY" },
              { type: "credential", label: "+98912•••0001" },
            ])
            // The list is asked for with the environment's key, so it is the account's full list.
            expect(yield* offered).toEqual(["claude-opus", "claude-sonnet", "deepseek"])
            expect(started.requests.filter((request) => request.path.endsWith("/llm/models"))).toEqual([
              { path: "/api/v1/llm/models", authorization: `Bearer ${key}`, body: undefined },
            ])
          }),
        )
        // Without the variable, the stored sign-in is the one in use again.
        const integrations = yield* Integration.Service
        expect(yield* integrations.connection.active(HamzadPlugin.integrationID)).toMatchObject({ type: "credential" })
      }),
    ),
  )

  it.live("sends titles to the model the gateway marks as small", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const resolve = (kind: "title" | "primary") =>
          hooks
            .trigger("session", "experimental.model.resolve", {
              sessionID: Session.ID.make("ses_hamzad"),
              agent: Agent.ID.make("title"),
              kind,
              model: Model.Ref.make({ providerID: HamzadModels.providerID, id: Model.ID.make("claude-sonnet") }),
            })
            .pipe(Effect.map((event) => event.model.id))
        expect(yield* resolve("title")).toBe(Model.ID.make("deepseek"))
        expect(yield* resolve("primary")).toBe(Model.ID.make("claude-sonnet"))
      }),
    ),
  )

  it.live("answers the interface with the credits left, and nothing while signed out", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const rpc = yield* Rpc.Service
        const balance = (fresh?: boolean) => rpc.call("hamzad.balance", "get", fresh === undefined ? {} : { fresh })
        expect(yield* balance()).toBeNull()
        yield* withEnv({ HAMZAD_API_KEY: key }, () =>
          Effect.gen(function* () {
            expect(yield* balance()).toEqual({ available: 497 })
            // The server remembers the answer for a moment; a finished request asks past that.
            expect(yield* balance()).toEqual({ available: 497 })
            expect(yield* balance(true)).toEqual({ available: 494 })
          }),
        )
      }),
    ),
  )

  it.live("says how to sign in when the gateway wants a key, and leaves every other refusal in its words", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const refused = (
          status: number,
          error: Record<string, unknown>,
          headers: { request?: Record<string, string>; response?: Record<string, string> } = {},
        ) =>
          hooks
            .trigger("session", "http.response", {
              sessionID: Session.ID.make("ses_hamzad"),
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({ providerID: HamzadModels.providerID, id: Model.ID.make("claude-sonnet") }),
              kind: "primary",
              request: new Request("https://hamzad.ai/api/v1/llm/chat/completions", { headers: headers.request }),
              response: Response.json({ error }, { status, headers: headers.response }),
            })
            .pipe(
              Effect.flatMap((event) =>
                Effect.promise(async () => ({
                  status: event.response.status,
                  retry: event.response.headers.get("retry-after"),
                  error: ((await event.response.json()) as { error: { message?: string } }).error,
                })),
              ),
            )
        const noKey = {
          code: "invalid_api_key",
          type: "authentication_error",
          message: "Missing or invalid API key. Sign in again, or make a key in the Hamzad panel.",
        }

        expect<unknown>(yield* refused(401, noKey)).toEqual({
          status: 401,
          retry: null,
          error: {
            code: "invalid_api_key",
            type: "authentication_error",
            message: "You are not signed in to Hamzad. Run `hamzad auth login` and approve this device in your panel.",
          },
        })
        expect((yield* refused(401, noKey, { request: { authorization: `Bearer ${key}` } })).error.message).toBe(
          "Hamzad did not accept this sign-in. Run `hamzad auth login` to sign in again.",
        )

        // The gateway's own text already carries the numbers and where to top up.
        const short = {
          code: "insufficient_quota",
          type: "insufficient_quota",
          message:
            "Not enough credits: this request needs 310 spendable, 12 are. Top up at https://hamzad.ai/panel/billing",
          needed: 310,
          available: 12,
        }
        expect<unknown>(yield* refused(402, short)).toEqual({ status: 402, retry: null, error: short })
        const day = {
          code: "daily_spend_limit",
          type: "insufficient_quota",
          message: "Today's usage limit of 800 credits is reached. It starts over at midnight, Tehran time.",
          limit: 800,
        }
        expect<unknown>(yield* refused(402, day)).toEqual({ status: 402, retry: null, error: day })
        // Switched off, the gateway answers "Not found."; on but not for this account, it says so itself.
        const off = { code: "not_found", type: "invalid_request_error", message: "Not found." }
        expect<unknown>(yield* refused(404, off, { request: { authorization: `Bearer ${key}` } })).toEqual({
          status: 404,
          retry: null,
          error: { ...off, message: "Hamzad's API for tools is not available yet." },
        })
        const closed = {
          code: "access_denied",
          type: "permission_error",
          message: "This account does not have access to the API yet.",
        }
        expect<unknown>(yield* refused(403, closed)).toEqual({ status: 403, retry: null, error: closed })
        const busy = { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Too many requests." }
        expect<unknown>(yield* refused(429, busy, { response: { "retry-after": "7" } })).toEqual({
          status: 429,
          retry: "7",
          error: busy,
        })
      }),
    ),
  )
})

describe("HamzadModels", () => {
  test("maps the gateway's fields and fills what it leaves out", () => {
    const [full, sparse] = HamzadModels.derive([sonnet, { id: "bare" }])
    expect(full).toMatchObject({
      id: "claude-sonnet",
      providerID: "hamzad",
      name: "Claude Sonnet 5.5",
      family: "claude-sonnet",
      compatibility: { cacheFormat: "anthropic" },
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      variants: [
        { id: "low", settings: { reasoningEffort: "low" } },
        { id: "medium", settings: { reasoningEffort: "medium" } },
        { id: "high", settings: { reasoningEffort: "high" } },
      ],
      cost: [{ input: 1271.4919, output: 6357.4594, cache: { read: 127.1492, write: 1589.3648 } }],
      limit: { context: 200000, output: 32000 },
    })
    expect(sparse).toMatchObject({
      id: "bare",
      name: "bare",
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      variants: [],
      time: { released: 0 },
      cost: [],
      limit: { context: 200000, output: 32000 },
    })
    expect(sparse?.compatibility).toBeUndefined()
  })

  test("the gateway's default sorts as the newest, so a new session opens with it", () => {
    const older = { ...sonnet, released: "2026-03-01" }
    const [first, second, third] = HamzadModels.derive([{ ...flash, released: "2026-09-01" }, older, { id: "bare" }])
    expect(first?.time.released).toBe(Date.parse("2026-09-01"))
    expect(second?.time.released).toBe(Date.parse("2026-09-01") + 1)
    expect(third?.time.released).toBe(0)
  })

  test("a cache price the gateway leaves out is the input price, and no cache format means no markers", () => {
    const [model] = HamzadModels.derive([flash])
    expect<unknown>(model?.cost).toEqual([
      { input: 190.7238, output: 762.8951, cache: { read: 190.7238, write: 190.7238 } },
    ])
    expect(model?.compatibility).toBeUndefined()
  })
})
