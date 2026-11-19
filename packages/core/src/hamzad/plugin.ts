export * as HamzadPlugin from "./plugin.js"

// Hamzad as a provider: sign-in, the model list and what a refused request says.

import os from "os"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHttpResponse } from "@opencode/plugin/effect/session"
import { Brand } from "@opencode/util/brand"
import { HamzadStatus } from "@opencode/util/hamzad-status"
import { Duration, Effect, Equal, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Agent } from "../agent.js"
import { App } from "../app.js"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { Model } from "../model.js"
import type { PluginInternal } from "../plugin/internal.js"
import { activeCredential } from "../plugin/provider/credential-settings.js"
import { ProviderRefresh } from "../plugin/provider/refresh.js"
import { SharedCache } from "../shared-cache.js"
import { HamzadBalance } from "./balance.js"
import { HamzadGateway } from "./gateway.js"
import { HamzadModels } from "./models.js"

export const integrationID = Integration.ID.make("hamzad")
export const keyVariable = "HAMZAD_API_KEY"
const methodID = Integration.MethodID.make("device")

// The last list the gateway gave, kept so a start with no network still shows the models.
const Saved = Schema.Struct({ api: Schema.String, models: HamzadGateway.Models })
const decodeSaved = Schema.decodeUnknownOption(Saved)
const encodeSaved = Schema.encodeSync(Schema.toCodecJson(Saved))
const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(HamzadGateway.Refusal))

/** The key a credential carries, whichever way the person signed in. */
export const secret = (credential: Credential.Value | undefined) =>
  credential?.type === "key" ? credential.key : credential?.type === "oauth" ? credential.access : undefined

export const Plugin = define({
  id: "hamzad.provider",
  effect: Effect.fn("HamzadPlugin")(function* (ctx) {
    const api = Brand.api()
    const agents = yield* Agent.Service
    const cache = yield* SharedCache.Service
    const client = yield* HttpClient.HttpClient
    const http = HttpClient.mapRequest(client, HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)))

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = Brand.name
      })
      editor.method.update(device(http, api))
      editor.method.update({ integrationID, method: { type: "key", label: "Paste a Hamzad API key" } })
      editor.method.update({ integrationID, method: { type: "env", names: [keyVariable] } })
    })

    // Why the list is as it is, for the command line and the interface to say when it is empty.
    const status = { models: "unreachable" as HamzadStatus.State }
    const said = yield* ctx.rpc
      .register(HamzadStatus.definition, { get: () => Effect.sync(() => ({ models: status.models })) })
      .pipe(Effect.orDie)

    // With a key the gateway lists what that account may use; without one, the models that need no
    // plan, so a person sees the models and their prices before signing in.
    const list = Effect.fn("HamzadPlugin.list")(function* (options: ProviderRefresh.Options) {
      const { connection, credential } = yield* activeCredential(ctx, integrationID)
      const key = secret(credential)
      const answer = yield* cache
        .get({
          key: `hamzad:models:${api}:${key ? SharedCache.fingerprint(key) : "signed-out"}`,
          ...options,
          load: HamzadGateway.models(http, api, key),
        })
        .pipe(Effect.orElseSucceed(() => ({ state: "unreachable" as const })))
      if (answer.state !== status.models) {
        status.models = answer.state
        yield* said.events.emit("changed", { models: answer.state }).pipe(Effect.ignore)
      }
      return { connection, models: answer.state === "listed" ? answer.models : undefined }
    })

    const remember = (models: typeof HamzadGateway.Models.Type) =>
      ctx.storage.set("models", encodeSaved({ api, models }))

    const saved = Option.getOrUndefined(decodeSaved(yield* ctx.storage.get("models")))
    // The very first start has nothing saved, so it waits a moment for the list instead of opening
    // with no models. Every later start shows the saved list at once and refreshes it behind.
    const first =
      saved?.api === api
        ? saved.models
        : yield* list({}).pipe(
            Effect.map((loaded) => loaded.models),
            Effect.timeoutOrElse({ duration: "4 seconds", orElse: () => Effect.undefined }),
            Effect.tap((models) => (models ? remember(models) : Effect.void)),
          )
    const discovered = yield* ProviderRefresh.start({
      integrationID,
      initial: first ?? [],
      active: ctx.integration.connection.active(integrationID),
      reload: ctx.provider.reload(),
      load: Effect.fn("HamzadPlugin.load")(function* (current, options) {
        const loaded = yield* list(options)
        // No list yet, or no network: what is shown stays.
        if (!loaded.models) return { connection: loaded.connection, value: current }
        if (!Equal.equals(loaded.models, current)) yield* remember(loaded.models)
        return { connection: loaded.connection, value: loaded.models }
      }),
    })

    yield* ctx.provider.transform((providers) => {
      providers.add({
        info: {
          id: HamzadModels.providerID,
          name: Brand.name,
          integrationID,
          // Offered before sign-in too: the models and prices are public, and a prompt sent without
          // a sign-in is answered with how to sign in.
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `${api}/llm`, provider: HamzadModels.providerID },
          // Asks the gateway to report each request's charge in credits, which is what the footer shows.
          headers: { "x-hamzad-cost-unit": "credit" },
          compatibility: { maxTokensField: "max_tokens", streamUsage: true },
        },
        models: HamzadModels.derive(discovered.current),
      })
    })

    yield* ctx.model.transform((models) => {
      const id = HamzadModels.preferred(discovered.current)
      if (!id || models.default.get() || !models.get(HamzadModels.providerID, id)) return
      models.default.set(HamzadModels.providerID, id)
    })

    // A session's title is written by the model the gateway marks as small, unless the person gave
    // the title agent a model of their own.
    yield* ctx.session.hook(
      "experimental.model.resolve",
      (event) =>
        Effect.gen(function* () {
          if (event.kind !== "title") return
          const id = HamzadModels.small(discovered.current)
          if (!id || event.model.id === id) return
          if ((yield* agents.get(Agent.ID.make("title")))?.model) return
          event.model = Model.Ref.make({ providerID: HamzadModels.providerID, id: Model.ID.make(id) })
        }),
      { providerID: HamzadModels.providerID },
    )

    yield* ctx.session.hook("http.response", explain, { providerID: HamzadModels.providerID })

    // What is left and what was used, for the footer, the sidebar and `/usage`. One answer from the
    // gateway serves them all for a moment; a finished request and an opened `/usage` ask past that.
    const told = {
      available: undefined as number | undefined,
      say: (_available: number): Effect.Effect<void> => Effect.void,
    }
    const usage = Effect.fn("HamzadPlugin.usage")(function* (fresh: boolean | undefined) {
      const key = secret((yield* activeCredential(ctx, integrationID)).credential)
      if (!key) return undefined
      const answer = yield* cache
        .get({
          key: `hamzad:usage:${api}:${SharedCache.fingerprint(key)}`,
          interval: "30 seconds",
          force: fresh,
          load: HamzadGateway.summary(http, api, key),
        })
        .pipe(Effect.orElseSucceed(() => undefined))
      if (!answer) return undefined
      const available = HamzadGateway.left(answer)
      if (available !== told.available) {
        told.available = available
        yield* told.say(available)
      }
      return { answer, available }
    })
    const account = yield* ctx.rpc
      .register(HamzadBalance.Definition, {
        get: (input) =>
          usage(input.fresh).pipe(Effect.map((current) => (current ? { available: current.available } : null))),
        usage: (input) =>
          usage(input.fresh).pipe(
            Effect.map((current) => {
              if (!current) return null
              const day = HamzadGateway.today(new Date())
              const spent = current.answer.byDay?.find((item) => item.day === day)
              return {
                available: current.available,
                pending: current.answer.pendingCredits ?? 0,
                today: { requests: spent?.requests ?? 0, credits: spent?.credits ?? 0 },
                days: current.answer.days ?? 30,
                total: current.answer.total ?? { requests: 0, credits: 0, promptTokens: 0, completionTokens: 0 },
                models: (current.answer.byModel ?? []).map((model) => ({
                  id: model.modelId,
                  requests: model.requests,
                  credits: model.credits,
                  promptTokens: model.promptTokens,
                  completionTokens: model.completionTokens,
                })),
              }
            }),
          ),
      })
      .pipe(Effect.orDie)
    told.say = (available) => account.events.emit("changed", { available }).pipe(Effect.ignore)
  }),
} satisfies PluginInternal.InternalPlugin)

function device(http: HttpClient.HttpClient, api: string) {
  return {
    integrationID,
    method: { id: methodID, type: "oauth", label: "Sign in with Hamzad" },
    authorize: () =>
      Effect.gen(function* () {
        const started = yield* HamzadGateway.device(http, api, `${Brand.name} CLI · ${os.hostname()}`)
        const url = yield* Effect.try({
          try: () => {
            const url = new URL(started.verification_uri_complete ?? started.verification_uri)
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S)")
            return url.href
          },
          catch: (cause) =>
            new Error(`Invalid sign-in address: ${cause instanceof Error ? cause.message : String(cause)}`),
        })
        return {
          mode: "auto" as const,
          url,
          instructions: `Enter code: ${started.user_code}`,
          expiresAt: Date.now() + started.expires_in * 1000,
          callback: HamzadGateway.token(http, api, started.device_code, Duration.seconds(started.interval)).pipe(
            Effect.map((token) =>
              // The panel hands the device a key of its own. It is not refreshed: it works until it is
              // revoked in the panel or runs out, and then the gateway asks for a new sign-in.
              Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: token.access_token,
                refresh: "",
                expires: 0,
                metadata: {
                  server: api,
                  ...(token.key_id ? { keyID: token.key_id } : {}),
                  ...(token.account ? { account: token.account } : {}),
                },
              }),
            ),
          ),
        }
      }),
    // The account's phone or email, as the gateway masks it.
    label: (credential) => (typeof credential.metadata?.account === "string" ? credential.metadata.account : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

/**
 * A refusal in words that say what to do, where this build knows more than the gateway's own
 * text does: the command that signs in, and that a gateway that is switched off ("Not found.")
 * is simply not open yet. Every other refusal keeps the gateway's wording, which already carries
 * the numbers and where to top up.
 */
export function message(code: string | null | undefined, signedIn: boolean) {
  if (code === "invalid_api_key") return signedIn ? HamzadStatus.refused : HamzadStatus.signedOut
  if (code === "not_found") return HamzadStatus.unavailable
  return undefined
}

// The status and headers stay as the gateway sent them, so retries, rate-limit waits and context
// compaction behave as they do for any provider. Neither status rewritten here is tried again.
function explain(event: SessionHttpResponse) {
  return Effect.gen(function* () {
    if (event.response.status !== 401 && event.response.status !== 404) return
    const body = yield* Effect.promise(() => event.response.clone().text())
    const refusal = Option.getOrUndefined(decodeRefusal(body))
    const text = refusal && message(refusal.error.code, event.request.headers.has("authorization"))
    if (!refusal || !text) return
    const headers = new Headers(event.response.headers)
    headers.delete("content-length")
    headers.delete("content-encoding")
    void event.response.body?.cancel()
    event.response = Response.json(
      { error: { code: refusal.error.code, type: refusal.error.type, message: text } },
      { status: event.response.status, headers },
    )
  })
}
