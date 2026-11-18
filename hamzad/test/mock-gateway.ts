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

export const models = [
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
    pricing: {
      unit: "credits_per_million_tokens",
      input: 1935.5,
      output: 9677.4,
      cache_read: 193.5,
      cache_write: 2419.4,
    },
    default: true,
    small: false,
  },
  {
    id: "deepseek",
    object: "model",
    owned_by: "DeepSeek",
    name: "DeepSeek Flash",
    family: null,
    released: "2026-08-13",
    context_window: 128000,
    max_output_tokens: 8000,
    capabilities: { tools: true, images: false, reasoning: false },
    pricing: { unit: "credits_per_million_tokens", input: 180, output: 720, cache_read: 18, cache_write: null },
    default: false,
    small: true,
  },
]

const refusals: Record<string, { status: number; type: string; message: string; extra?: Record<string, unknown> }> = {
  invalid_api_key: { status: 401, type: "authentication_error", message: "The API key is not valid." },
  insufficient_quota: {
    status: 402,
    type: "insufficient_quota",
    message: "Not enough credits for this request.",
    extra: { needed: 310, available: 12 },
  },
  key_spend_cap: { status: 402, type: "insufficient_quota", message: "This key has reached its spend cap." },
  access_denied: { status: 403, type: "permission_error", message: "This account cannot use the gateway yet." },
  model_not_found: { status: 404, type: "invalid_request_error", message: "No such model." },
  context_length_exceeded: {
    status: 400,
    type: "invalid_request_error",
    message: "The conversation is longer than the model reads.",
  },
  rate_limit_exceeded: { status: 429, type: "rate_limit_error", message: "Too many requests." },
  upstream_unavailable: { status: 503, type: "server_error", message: "The model is not reachable right now." },
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

export function start(options: { port?: number; approveAfter?: number; credits?: number } = {}) {
  const requests: Recorded[] = []
  const state = { polls: 0, credits: options.credits ?? 5000, spent: 0 }
  const error = (code: string) => {
    const refusal = refusals[code] ?? { status: 400, type: "invalid_request_error", message: code }
    return Response.json(
      {
        error: { message: refusal.message, message_fa: null, type: refusal.type, code, param: null, ...refusal.extra },
        request_id: crypto.randomUUID(),
      },
      { status: refusal.status, headers: refusal.status === 429 ? { "retry-after": "1" } : {} },
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

      if (path === "/auth/device/code") {
        record()
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
        })
      }
      if (path === "/panel/device")
        return new Response("Mock approval page: this sign-in approves itself.", {
          headers: { "content-type": "text/plain" },
        })

      if (!path.startsWith("/llm/")) return new Response("Not found", { status: 404 })
      if (authorization !== `Bearer ${key}`) {
        record()
        return error("invalid_api_key")
      }
      if (path === "/llm/models") {
        record()
        return Response.json({ object: "list", data: models })
      }
      if (path === "/llm/usage/summary") {
        record()
        return Response.json({
          balance: { available: Math.floor(state.credits - state.spent), reserved: 0 },
          spent: state.spent,
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
