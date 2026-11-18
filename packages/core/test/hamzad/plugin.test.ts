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
  pricing: {
    unit: "credits_per_million_tokens",
    input: 1935.5,
    output: 9677.4,
    cache_read: 193.5,
    cache_write: 2419.4,
  },
  default: true,
  small: false,
}
const flash = {
  id: "deepseek",
  object: "model",
  name: "DeepSeek Flash",
  context_window: 128000,
  max_output_tokens: 8000,
  capabilities: { tools: true, images: false, reasoning: false },
  pricing: { unit: "credits_per_million_tokens", input: 180, output: 720, cache_read: null },
  default: false,
  small: true,
}

// A stand-in for Hamzad's API. `approveAfter` is how many times the device poll answers "pending" first.
function gateway(input: { models?: unknown[]; approveAfter?: number; deny?: boolean } = {}) {
  const requests: { path: string; authorization: string | null; body?: unknown }[] = []
  const state = { polls: 0, models: input.models ?? [sonnet, flash], down: false }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const body: unknown = request.method === "POST" ? await request.json() : undefined
      requests.push({ path, authorization: request.headers.get("authorization"), body })
      if (state.down) return new Response("unavailable", { status: 503 })
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
        })
      }
      if (path === "/api/v1/llm/models") {
        if (request.headers.get("authorization") !== `Bearer ${key}`)
          return Response.json({ error: { code: "invalid_api_key", message: "no" } }, { status: 401 })
        return Response.json({ object: "list", data: state.models })
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

const hamzadModels = Effect.gen(function* () {
  const models = yield* Model.Service
  return (yield* models.available()).filter((model) => model.providerID === HamzadModels.providerID)
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

  it.live("has no models and is not offered while signed out", () =>
    served({}, (started) =>
      Effect.gen(function* () {
        yield* addPlugin()
        const providers = yield* Provider.Service
        expect((yield* providers.available()).map((provider) => provider.id)).not.toContain(HamzadModels.providerID)
        expect(yield* hamzadModels).toEqual([])
        expect(started.requests.filter((request) => request.path.endsWith("/llm/models"))).toEqual([])
      }),
    ),
  )

  it.live("signs in by approving the device and then lists the gateway's models", () =>
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
        expect((yield* credentials.list(HamzadPlugin.integrationID))[0]?.value).toEqual(
          Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("device"),
            access: key,
            refresh: "",
            expires: 0,
            metadata: { server: started.api, keyID: "key_1" },
          }),
        )

        const models = yield* eventually(hamzadModels, (models) => models.length === 2)
        expect(models.map((model) => String(model.id)).toSorted()).toEqual(["claude-sonnet", "deepseek"])
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
          yield* eventually(hamzadModels, (models) => models.length === 2)
          expect(yield* host.storage.get("models")).toMatchObject({
            api: started.api,
            models: [{ id: "claude-sonnet" }, { id: "deepseek" }],
          })

          // A later start reads what the earlier one saved before it hears from the gateway.
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

  it.live("sends titles to the model the gateway marks as small", () =>
    served({}, () =>
      withEnv({ HAMZAD_API_KEY: key }, () =>
        Effect.gen(function* () {
          yield* addPlugin()
          yield* eventually(hamzadModels, (models) => models.length === 2)
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
    ),
  )

  it.live("says what to do when the gateway refuses a request", () =>
    served({}, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const refused = (status: number, error: Record<string, unknown>, headers?: Record<string, string>) =>
          hooks
            .trigger("session", "http.response", {
              sessionID: Session.ID.make("ses_hamzad"),
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({ providerID: HamzadModels.providerID, id: Model.ID.make("claude-sonnet") }),
              kind: "primary",
              request: new Request("https://hamzad.ai/api/v1/llm/chat/completions"),
              response: Response.json({ error, request_id: "req_1" }, { status, headers }),
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

        expect<unknown>(
          yield* refused(401, { code: "invalid_api_key", type: "authentication_error", message: "Invalid key" }),
        ).toEqual({
          status: 401,
          retry: null,
          error: {
            code: "invalid_api_key",
            type: "authentication_error",
            message: "Hamzad did not accept this sign-in. Run `hamzad auth login` to sign in again.",
          },
        })
        expect(
          (yield* refused(402, { code: "insufficient_quota", type: "insufficient_quota", needed: 310, available: 12 }))
            .error.message,
        ).toBe(
          "Not enough Hamzad credits for this request (it may need up to 310, 12 available). Top up at https://hamzad.ai/panel/billing",
        )
        // Anything without advice of its own keeps the gateway's wording, its status and its wait.
        expect<unknown>(
          yield* refused(
            429,
            { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Too many requests." },
            { "retry-after": "7" },
          ),
        ).toEqual({
          status: 429,
          retry: "7",
          error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Too many requests." },
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
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      variants: [
        { id: "low", settings: { reasoningEffort: "low" } },
        { id: "medium", settings: { reasoningEffort: "medium" } },
        { id: "high", settings: { reasoningEffort: "high" } },
      ],
      time: { released: Date.parse("2026-09-01") },
      cost: [{ input: 1935.5, output: 9677.4, cache: { read: 193.5, write: 2419.4 } }],
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
  })

  test("a cache price the gateway leaves out is the input price", () => {
    expect<unknown>(HamzadModels.derive([flash])[0]?.cost).toEqual([
      { input: 180, output: 720, cache: { read: 180, write: 180 } },
    ])
  })
})
