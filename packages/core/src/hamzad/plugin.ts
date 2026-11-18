export * as HamzadPlugin from "./plugin.js"

// Hamzad as a provider: sign-in, the model list and what a refused request says.

import os from "os"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHttpResponse } from "@opencode/plugin/effect/session"
import { Brand } from "@opencode/util/brand"
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

    const saved = Option.getOrUndefined(decodeSaved(yield* ctx.storage.get("models")))
    const discovered = yield* ProviderRefresh.start({
      integrationID,
      initial: saved?.api === api ? saved.models : [],
      active: ctx.integration.connection.active(integrationID),
      reload: ctx.provider.reload(),
      load: Effect.fn("HamzadPlugin.load")(function* (current, options) {
        const { connection, credential } = yield* activeCredential(ctx, integrationID)
        const key = secret(credential)
        // Signed out, the last list stays: it is what the person sees again after signing in.
        if (!key) return { connection, value: current }
        const loaded = yield* cache
          .get({
            key: `hamzad:${api}:${SharedCache.fingerprint(key)}`,
            ...options,
            load: HamzadGateway.models(http, api, key),
          })
          .pipe(Effect.option)
        if (Option.isNone(loaded)) return { connection, value: current }
        if (!Equal.equals(loaded.value, current))
          yield* ctx.storage.set("models", encodeSaved({ api, models: loaded.value }))
        return { connection, value: loaded.value }
      }),
    })

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = Brand.name
      })
      editor.method.update(device(http, api))
      editor.method.update({ integrationID, method: { type: "key", label: "Paste a Hamzad API key" } })
      editor.method.update({ integrationID, method: { type: "env", names: [keyVariable] } })
    })

    yield* ctx.provider.transform((providers) => {
      providers.add({
        info: {
          id: HamzadModels.providerID,
          name: Brand.name,
          integrationID,
          activation: "auto",
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

    // Titles and other small requests go to the model the gateway marks for them, unless the person
    // gave the title agent a model of their own.
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
                metadata: { server: api, ...(token.key_id ? { keyID: token.key_id } : {}) },
              }),
            ),
          ),
        }
      }),
  } satisfies IntegrationOAuthMethodRegistration
}

/** What a refusal means for the person, by the gateway's code. The gateway's own text is the fallback. */
export function message(refusal: HamzadGateway.Refusal["error"]) {
  const needed = refusal.details?.needed ?? refusal.needed
  const available = refusal.details?.available ?? refusal.available
  switch (refusal.code) {
    case "invalid_api_key":
      return `Hamzad did not accept this sign-in. Run \`${Brand.cli} auth login\` to sign in again.`
    case "insufficient_quota":
      return [
        "Not enough Hamzad credits for this request",
        needed != null && available != null ? ` (it may need up to ${needed}, ${available} available)` : "",
        `. Top up at ${Brand.billing}`,
      ].join("")
    case "key_spend_cap":
      return `This key has reached its spend cap. Raise the cap or make a new key at https://hamzad.ai/panel/settings`
    case "daily_spend_limit":
      return "Daily usage limit reached for this account. It resets at midnight, Tehran time."
    case "access_denied":
      return "This account cannot use Hamzad's coding models yet."
    case "plan_required":
      return `This model needs a higher plan. See ${Brand.billing}`
    default:
      return refusal.message ?? undefined
  }
}

// Replaces a refusal's text with what the person can do about it. The status and headers stay, so
// retries, rate-limit waits and context compaction behave as they do for any provider.
function explain(event: SessionHttpResponse) {
  return Effect.gen(function* () {
    if (event.response.status < 400) return
    const body = yield* Effect.promise(() => event.response.clone().text())
    const refusal = Option.getOrUndefined(decodeRefusal(body))
    const text = refusal && message(refusal.error)
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
