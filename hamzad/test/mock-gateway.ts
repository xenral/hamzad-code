// A stand-in for Hamzad's API, for running the CLI with no account and no network:
// the device sign-in, the model list, a scripted chat stream and the balance.
//
//   bun hamzad/test/mock-gateway.ts [--port 8787]
//   HAMZAD_API_URL=http://127.0.0.1:8787/api/v1 bun run dev
//
// The chat route answers by what the conversation holds, so a test can drive it from the prompt:
//   [[tool:NAME {json arguments}]]   the model calls that tool with those arguments, in fragments
//   [[refuse:CODE]]                  the request is refused before any output (see `refusals`)
//   [[cut]]                          the stream breaks with an error after some text
// After a tool result comes back, the reply quotes it, which proves the round trip.

export const key = `sk-hmz-${"t".repeat(43)}`
// A second valid key, as one made in the panel: what a person puts in HAMZAD_API_KEY.
export const panelKey = `sk-hmz-${"p".repeat(43)}`

const price = (input: number, output: number, read: number, write: number | null) => ({
  unit: "credits_per_million_tokens",
  input,
  output,
  cache_read: read,
  cache_write: write,
})

// What the real gateway lists, plus one model that needs a plan, which only a signed-in account sees.
export const models = [
  {
    id: "claude-haiku",
    object: "model",
    owned_by: "Anthropic",
    name: "Claude Haiku 5.5",
    family: "claude-haiku",
    released: "2026-09-01",
    context_window: 200000,
    max_output_tokens: 16000,
    capabilities: { tools: true, images: true, reasoning: true },
    reasoning_efforts: ["low", "medium", "high"],
    cache_format: "anthropic",
    pricing: price(63.5746, 317.873, 6.3575, 79.4682),
    default: false,
    small: true,
    plan: false,
  },
  {
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
    cache_format: "anthropic",
    pricing: price(1271.4919, 6357.4594, 127.1492, 1589.3648),
    default: true,
    small: false,
    plan: false,
  },
  {
    id: "deepseek",
    object: "model",
    owned_by: "DeepSeek",
    name: "DeepSeek V4.1 Flash",
    family: "deepseek",
    released: "2026-09-01",
    context_window: 128000,
    max_output_tokens: 16000,
    capabilities: { tools: true, images: false, reasoning: false },
    reasoning_efforts: null,
    cache_format: null,
    pricing: price(190.7238, 762.8951, 19.0724, null),
    default: false,
    small: false,
    plan: false,
  },
  {
    id: "claude-opus",
    object: "model",
    owned_by: "Anthropic",
    name: "Claude Opus 5.5",
    family: "claude-opus",
    released: "2026-09-01",
    context_window: 200000,
    max_output_tokens: 32000,
    capabilities: { tools: true, images: true, reasoning: true },
    reasoning_efforts: ["low", "medium", "high"],
    cache_format: "anthropic",
    pricing: price(6357.4594, 31787.297, 635.7459, 7946.8243),
    default: false,
    small: false,
    plan: true,
  },
]

// The gateway's own codes, statuses and wording. The numbers beside a code sit flat under `error`.
const refusals: Record<
  string,
  { status: number; type: string; message: string; extra?: Record<string, unknown>; headers?: Record<string, string> }
> = {
  invalid_api_key: {
    status: 401,
    type: "authentication_error",
    message: "Missing or invalid API key. Sign in again, or make a key in the Hamzad panel.",
  },
  insufficient_quota: {
    status: 402,
    type: "insufficient_quota",
    message: "Not enough credits: this request needs 310 spendable, 12 are. Top up at https://hamzad.ai/panel/billing",
    extra: { needed: 310, available: 12 },
  },
  key_spend_cap: {
    status: 402,
    type: "insufficient_quota",
    message: "This key has reached its own spending cap of 500 credits.",
    extra: { limit: 500 },
  },
  // A 402, not a 429: a client waits and retries a rate limit, and this one would have it trying until midnight.
  daily_spend_limit: {
    status: 402,
    type: "insufficient_quota",
    message: "Today's usage limit of 800 credits is reached. It starts over at midnight, Tehran time.",
    extra: { limit: 800 },
  },
  access_denied: {
    status: 403,
    type: "permission_error",
    message: "This account does not have access to the API yet.",
  },
  model_not_found: {
    status: 404,
    type: "invalid_request_error",
    message: "This model does not exist or is not offered. See /models for the list.",
  },
  context_length_exceeded: {
    status: 400,
    type: "invalid_request_error",
    message: "This request is longer than the model's context window. Shorten the conversation.",
  },
  rate_limit_exceeded: { status: 429, type: "rate_limit_error", message: "Too many requests. Try again shortly." },
  upstream_unavailable: {
    status: 503,
    type: "server_error",
    message: "The model could not be reached. Try again, or choose another model.",
  },
  // The model's provider turned the gateway itself away: asking again at once is no use, and the gateway says so.
  model_unavailable: {
    status: 503,
    type: "server_error",
    message: "This model is not available right now. Choose another model.",
    headers: { "x-should-retry": "false" },
  },
  not_found: { status: 404, type: "invalid_request_error", message: "Not found." },
}

export interface Recorded {
  readonly path: string
  readonly method: string
  readonly authorization: string | null
  readonly unit: string | null
  readonly agent: string | null
  readonly body?: {
    readonly model?: string
    readonly stream?: boolean
    readonly usage?: boolean
    readonly tools: readonly string[]
    readonly roles: readonly string[]
    /** How the instructions open: the sentence that tells the model what it is running in. */
    readonly opening: string
  }
}

type Message = {
  role: string
  content?: string | { type: string; text?: string }[] | null
  tool_calls?: unknown[]
}
type Chat = {
  model?: string
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  tools?: { type: string; function?: { name: string } }[]
  messages?: Message[]
}

const text = (message: Message | undefined) =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? []).map((part) => part.text ?? "").join("")

type Stage = "everyone" | "staff" | "off" | "absent"

// The block of credits the gateway holds while a session is under way.
const hold = 500
// The name a key made by the device sign-in carries.
const deviceKeyName = "Hamzad CLI · test-machine"
// The gateway counts a day as Tehran's.
const tehranDay = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

export function start(
  options: {
    port?: number
    approveAfter?: number
    credits?: number
    /**
     * Whom the gateway serves: until it is `everyone` the model list asks for a key; `off` is a 404;
     * `absent` is an API from before any of these routes existed.
     */
    stage?: Stage
  } = {},
) {
  // `state` may be changed while the gateway runs, as a setting would be: `stage`, `denied` (it
  // is on, but not for the signed-in account) and `attempts` (too many sign-ins were started).
  const requests: Recorded[] = []
  const state = {
    polls: 0,
    credits: options.credits ?? 5000,
    spent: 0,
    // What each model and each key was used for, as the usage summary counts it.
    used: [] as { model: string; key: string; credits: number; prompt: number; cached: number; completion: number }[],
    stage: options.stage ?? ("everyone" as Stage),
    denied: false,
    attempts: false,
  }
  // The sign-in routes refuse in the API's own shape, with a Persian message written for the panel.
  const turnedAway = (status: number, code: string, message: string) =>
    Response.json({ code, message, requestId: crypto.randomUUID() }, { status })
  const unavailable = () => turnedAway(404, "auth.device_unavailable", "این امکان در دسترس نیست.")
  const error = (code: string) => {
    const refusal = refusals[code] ?? { status: 400, type: "invalid_request_error", message: code }
    return Response.json(
      {
        error: { message: refusal.message, message_fa: null, type: refusal.type, code, param: null, ...refusal.extra },
      },
      {
        status: refusal.status,
        headers: { ...(refusal.status === 429 ? { "retry-after": "1" } : {}), ...refusal.headers },
      },
    )
  }
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    idleTimeout: 120,
    fetch: async (request) => {
      const url = new URL(request.url)
      const path = url.pathname.replace(/^\/api\/v1/, "")
      const authorization = request.headers.get("authorization")
      const record = (body?: Recorded["body"]) =>
        requests.push({
          path,
          method: request.method,
          authorization,
          unit: request.headers.get("x-hamzad-cost-unit"),
          agent: request.headers.get("user-agent"),
          body,
        })

      // An API without these routes answers every one of them as an address it does not have.
      if (state.stage === "absent" && path !== "/panel/device") {
        record()
        return turnedAway(404, "resource.not_found", "چیزی که دنبالش بودی پیدا نشد.")
      }

      if (path === "/auth/device/code") {
        record()
        if (state.stage === "off") return unavailable()
        if (state.attempts)
          return turnedAway(429, "auth.device_attempts", "تلاش‌های زیادی شد. کمی بعد دوباره امتحان کن.")
        state.polls = 0
        return Response.json({
          device_code: "mock-device-code",
          user_code: "ABCD-EFGH",
          verification_uri: `${url.origin}/panel/device`,
          verification_uri_complete: `${url.origin}/panel/device?code=ABCD-EFGH`,
          expires_in: 600,
          interval: 1,
        })
      }
      if (path === "/auth/device/token") {
        record()
        if (state.stage === "off") return unavailable()
        state.polls++
        if (state.polls <= (options.approveAfter ?? 1))
          return Response.json(
            { error: "authorization_pending", error_description: "Waiting for approval." },
            { status: 400 },
          )
        return Response.json({
          access_token: key,
          token_type: "bearer",
          expires_in: 180 * 86400,
          key_id: "mock-key",
          base_url: `${url.origin}/api/v1/llm`,
          account: "+98912•••0001",
        })
      }
      if (path === "/panel/device")
        return new Response("Mock approval page: this sign-in approves itself.", {
          headers: { "content-type": "text/plain" },
        })

      if (!path.startsWith("/llm/")) return new Response("Not found", { status: 404 })
      const signedIn = authorization === `Bearer ${key}` || authorization === `Bearer ${panelKey}`
      if (path === "/llm/models") {
        record()
        if (state.stage === "off") return error("not_found")
        // Open to anyone once the gateway serves everyone. A signed-out list holds what needs no plan.
        if (!signedIn && (state.stage !== "everyone" || authorization)) return error("invalid_api_key")
        if (signedIn && state.denied) return error("access_denied")
        return Response.json({
          object: "list",
          data: models.filter((model) => signedIn || !model.plan).map(({ plan: _, ...model }) => model),
        })
      }
      if (path !== "/llm/chat/completions" && (state.stage === "off" || !signedIn || state.denied)) {
        record()
        return error(state.stage === "off" ? "not_found" : signedIn ? "access_denied" : "invalid_api_key")
      }
      if (path === "/llm/usage/summary") {
        record()
        // The real answer, field for field. Nothing here is settled into the credit history, so all
        // that was used is pending: `available` is whole credits, less the pending amount rounded up.
        const round = (credits: number) => Math.round(credits * 1e4) / 1e4
        const count = (rows: typeof state.used) => ({
          requests: rows.length,
          credits: round(rows.reduce((sum, row) => sum + row.credits, 0)),
        })
        const tokens = (rows: typeof state.used) => ({
          promptTokens: rows.reduce((sum, row) => sum + row.prompt, 0),
          completionTokens: rows.reduce((sum, row) => sum + row.completion, 0),
        })
        const by = (pick: (row: (typeof state.used)[number]) => string) =>
          [...Map.groupBy(state.used, pick)].toSorted((a, b) => count(b[1]).credits - count(a[1]).credits)
        return Response.json({
          balance: {
            credits: state.credits,
            reserved: state.used.length > 0 ? hold : 0,
            available: Math.max(0, Math.floor(state.credits - state.spent)),
          },
          pendingCredits: round(state.spent),
          days: Number(url.searchParams.get("days") ?? 30),
          total: { ...count(state.used), ...tokens(state.used) },
          byDay: state.used.length > 0 ? [{ day: tehranDay(new Date()), ...count(state.used) }] : [],
          byModel: by((row) => row.model).map(([modelId, rows]) => ({
            modelId,
            ...count(rows),
            promptTokens: tokens(rows).promptTokens,
            cachedTokens: rows.reduce((sum, row) => sum + row.cached, 0),
            completionTokens: tokens(rows).completionTokens,
          })),
          byKey: by((row) => row.key).map(([name, rows]) => ({
            keyId:
              name === deviceKeyName ? "0b6f3f0e-6c1d-4a39-9a55-1f0c2d7e8a01" : "0b6f3f0e-6c1d-4a39-9a55-1f0c2d7e8a02",
            name,
            ...count(rows),
          })),
        })
      }
      if (path !== "/llm/chat/completions" || request.method !== "POST")
        return new Response("Not found", { status: 404 })

      const raw = await request.text()
      const chat = JSON.parse(raw) as Chat
      const messages = chat.messages ?? []
      record({
        model: chat.model,
        stream: chat.stream,
        usage: chat.stream_options?.include_usage,
        tools: (chat.tools ?? []).flatMap((tool) => tool.function?.name ?? []),
        roles: messages.map((message) => message.role),
        opening: text(messages.find((message) => message.role === "system" || message.role === "developer"))
          .split("\n")[0]
          .slice(0, 200),
      })
      // Switched off, the gateway is not there for anyone, whatever key is sent.
      if (state.stage === "off") return error("not_found")
      if (!signedIn) return error("invalid_api_key")
      if (state.denied) return error("access_denied")
      const last = messages.at(-1)
      const asked = text(messages.findLast((message) => message.role === "user"))
      const refuse = /\[\[refuse:([a-z_]+)\]\]/.exec(asked)
      if (refuse && last?.role !== "tool") return error(refuse[1])

      const model = models.find((item) => item.id === chat.model)
      if (!model) return error("model_not_found")
      const call = last?.role === "tool" ? null : /\[\[tool:([A-Za-z0-9_-]+) (\{.*?\})\]\]/s.exec(asked)
      const reply =
        last?.role === "tool"
          ? `The tool returned: ${text(last).slice(0, 400)}`
          : chat.tools?.length
            ? "Mock reply from Hamzad's stand-in gateway."
            : "Mock title"
      const promptTokens = Math.ceil(raw.length / 4)
      const completionTokens = Math.ceil((call ? call[2].length : reply.length) / 4) + 1
      const cached = Math.floor(promptTokens / 2)
      const credits =
        ((promptTokens - cached) * model.pricing.input +
          cached * (model.pricing.cache_read ?? model.pricing.input) +
          completionTokens * model.pricing.output) /
        1e6
      const id = `chatcmpl-${crypto.randomUUID()}`
      const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) =>
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: model.id, choices, ...extra })}\n\n`
      const usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
        hamzad_credits: credits,
        ...(request.headers.get("x-hamzad-cost-unit") === "credit" ? { cost: credits, cost_unit: "credit" } : {}),
      }
      const frames = call
        ? [
            chunk([{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }]),
            chunk([
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_mock_1", type: "function", function: { name: call[1], arguments: "" } },
                  ],
                },
                finish_reason: null,
              },
            ]),
            // The arguments arrive split in two, as real providers send them.
            ...[call[2].slice(0, Math.ceil(call[2].length / 2)), call[2].slice(Math.ceil(call[2].length / 2))].map(
              (part) =>
                chunk([
                  {
                    index: 0,
                    delta: { tool_calls: [{ index: 0, function: { arguments: part } }] },
                    finish_reason: null,
                  },
                ]),
            ),
            chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
          ]
        : [
            chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]),
            ...(reply.match(/.{1,24}/gs) ?? []).map((part) =>
              chunk([{ index: 0, delta: { content: part }, finish_reason: null }]),
            ),
            ...(asked.includes("[[cut]]") && last?.role !== "tool"
              ? []
              : [chunk([{ index: 0, delta: {}, finish_reason: "stop" }])]),
          ]
      const tail =
        asked.includes("[[cut]]") && last?.role !== "tool"
          ? [
              chunk([], { usage }),
              chunk([{ index: 0, delta: {}, finish_reason: "error" }], {
                error: {
                  message: "The model stopped answering.",
                  message_fa: null,
                  type: "server_error",
                  code: "upstream_unavailable",
                  param: null,
                },
              }),
            ]
          : [chunk([], { usage })]
      state.spent += credits
      state.used.push({
        model: model.id,
        key: authorization === `Bearer ${panelKey}` ? "My laptop" : deviceKeyName,
        credits,
        prompt: promptTokens,
        cached,
        completion: completionTokens,
      })
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"))
            for (const frame of [...frames, ...tail, "data: [DONE]\n\n"]) {
              controller.enqueue(encoder.encode(frame))
              await Bun.sleep(2)
            }
            controller.close()
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store, no-transform",
            "x-request-id": id,
          },
        },
      )
    },
  })
  return { server, requests, state, api: `http://127.0.0.1:${server.port}/api/v1` }
}

if (import.meta.main) {
  const port = process.argv.indexOf("--port")
  const started = start({ port: port === -1 ? 8787 : Number(process.argv[port + 1]) })
  console.log(`Mock Hamzad gateway on ${started.api}`)
  console.log(`  HAMZAD_API_URL=${started.api}`)
  console.log(`  HAMZAD_API_KEY=${key}   (or sign in: the device approves itself)`)
}
