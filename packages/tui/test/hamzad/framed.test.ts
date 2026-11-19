import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { turnCost } from "../../src/hamzad/answer-footer"
import { HamzadLook } from "../../src/hamzad/look"
import { describe as line } from "../../src/hamzad/tool-step"

const tool = (
  name: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  status = "completed",
) =>
  ({
    type: "tool",
    id: `call_${name}`,
    name,
    state: { status, input, metadata, content: [] },
  }) as unknown as SessionMessageAssistantTool
const path = (value: string | undefined) => value ?? ""

describe.skipIf(!Brand.isHamzad)("the Framed layout", () => {
  test("is this build's, and upstream's build keeps its own", () => {
    expect(HamzadLook.framed).toBe(true)
    expect(HamzadLook.pad(3)).toBe(0)
    expect(HamzadLook.flat("fill")).toBeUndefined()
    expect(HamzadLook.grouping).toBe("none")
  })

  test("a tool step reads as its name, what it worked on and what came of it", () => {
    expect(line(tool("read", { path: "src/auth/login.ts" }), path)).toMatchObject({ target: "src/auth/login.ts" })
    expect(line(tool("grep", { pattern: "attempts", path: "src/auth" }, { matches: 3 }), path)).toMatchObject({
      target: '"attempts" in src/auth',
      result: "3 matches",
    })
    expect(
      line(tool("edit", { path: "src/auth/login.ts" }, { files: [{ additions: 9, deletions: 2 }] }), path),
    ).toMatchObject({ target: "src/auth/login.ts", result: "+9 −2", opens: true })
    expect(line(tool("bash", { command: "npm test\nnpm run lint" }, { exit: 1 }), path)).toMatchObject({
      target: "npm test",
      result: "exit 1",
      bad: true,
    })
    expect(line(tool("bash", { command: "npm test" }, { exit: 0 }), path)).toMatchObject({
      result: undefined,
      bad: false,
    })
    expect(line(tool("some_mcp_tool", { repo: "shop", count: 2 }), path)).toMatchObject({
      target: "[repo=shop, count=2]",
    })
  })

  test("tool steps in a row sit together; everything else keeps a line of space above it", () => {
    const step = { type: "part", ref: { messageID: "m", partID: "call_1" } }
    const text = { type: "part", ref: { messageID: "m", partID: "text:0" } }
    const user = { type: "message", messageID: "u" }
    expect(HamzadLook.gap(step, step)).toBe(0)
    expect(HamzadLook.gap(step, { type: "group", kind: "exploration" })).toBe(0)
    expect(HamzadLook.gap(step, user)).toBe(1)
    expect(HamzadLook.gap(text, step)).toBe(1)
    expect(HamzadLook.gap(step)).toBe(1)
  })

  test("an answer costs what every step of its turn cost, since the person's message", () => {
    const messages = [
      { id: "u0", type: "user" },
      { id: "a0", type: "assistant", cost: 5 },
      { id: "u1", type: "user" },
      { id: "a1", type: "assistant", cost: 1.25 },
      { id: "a2", type: "assistant", cost: 2.5 },
      { id: "a3", type: "assistant", cost: 9 },
    ] as unknown as SessionMessageInfo[]
    expect(turnCost(messages, messages[4] as SessionMessageAssistant)).toBe(3.75)
    expect(turnCost(messages, messages[1] as SessionMessageAssistant)).toBe(5)
  })
})
