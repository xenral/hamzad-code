import type { SessionMessageAssistantTool } from "@opencode/client"
import type { RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import stripAnsi from "strip-ansi"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { usePathFormatter } from "../context/path-format"
import { useTheme } from "../context/theme"
import { toolDisplay } from "../routes/session/message-parts"
import { use } from "../routes/session/render-context"
import {
  executeCalls,
  finiteNumber,
  primitiveInputSummary,
  toolDisplayContent,
  toolDisplayMetadata,
} from "../util/tool-display"
import { STEP_INDENT } from "./look"

// A tool step as one line, set in under the speakers: `◆ <tool>  <target>  <result>`. A running
// step shows a spinner in place of the mark, a failed one a red mark. A step with more to show (a
// diff, a command's output, a list) opens it below, on a click, as upstream's view of it.

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
const first = (value: string | undefined) => value?.split("\n")[0]
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

type Line = {
  /** What it worked on: a file, a pattern, a command. */
  target?: string
  /** What came of it, on the right. */
  result?: string
  /** Whether the result is bad news. */
  bad?: boolean
  /** Whether upstream's view of it shows anything the line does not. */
  opens: boolean
}

/** The file changes a step reports, summed, as `+9 −2`. */
function changes(metadata: Record<string, unknown>) {
  const files = Array.isArray(metadata.files) ? metadata.files : []
  const counts = files.reduce<{ added: number; removed: number; any: boolean }>(
    (total, file) => {
      if (!file || typeof file !== "object") return total
      const added = finiteNumber((file as Record<string, unknown>).additions)
      const removed = finiteNumber((file as Record<string, unknown>).deletions)
      if (added === undefined && removed === undefined) return total
      return { added: total.added + (added ?? 0), removed: total.removed + (removed ?? 0), any: true }
    },
    { added: 0, removed: 0, any: false },
  )
  return counts.any ? `+${counts.added} −${counts.removed}` : undefined
}

/** The line for a step, from its name, its input and what it reported. */
export function describe(part: SessionMessageAssistantTool, path: (value: string | undefined) => string): Line {
  const input = typeof part.state.input === "string" ? {} : (part.state.input ?? {})
  const metadata = toolDisplayMetadata(part.state)
  const name = toolDisplay(part.name)
  const where = (value: unknown) => (text(value) ? ` in ${path(text(value))}` : "")
  switch (name) {
    case "read":
      return { target: text(input.path) && path(text(input.path)), opens: false }
    case "grep": {
      const matches = finiteNumber(metadata.matches)
      return {
        target: text(input.pattern) && `"${text(input.pattern)}"${where(input.path)}`,
        result: matches === undefined ? undefined : plural(matches, "match", "matches"),
        opens: false,
      }
    }
    case "glob": {
      const count = finiteNumber(metadata.count)
      return {
        target: text(input.pattern) && `${text(input.pattern)}${where(input.path)}`,
        result: count === undefined ? undefined : plural(count, "file"),
        opens: false,
      }
    }
    case "edit":
    case "write":
      return { target: text(input.path) && path(text(input.path)), result: changes(metadata), opens: true }
    case "patch": {
      const files = Array.isArray(metadata.files) ? metadata.files.length : 0
      return { target: files ? plural(files, "file") : undefined, result: changes(metadata), opens: true }
    }
    case "shell": {
      const exit = finiteNumber(metadata.exit)
      return {
        target: first(text(input.command)),
        result:
          exit !== undefined && exit !== 0
            ? `exit ${exit}`
            : metadata.status === "running"
              ? "in background"
              : undefined,
        bad: exit !== undefined && exit !== 0,
        opens: true,
      }
    }
    case "webfetch":
      return { target: text(input.url), opens: false }
    case "websearch":
      return { target: text(input.query), opens: false }
    case "subagent":
      return { target: first(text(input.description) ?? text(input.prompt)), opens: true }
    case "todowrite": {
      const todos = Array.isArray(input.todos) ? input.todos : []
      const done = todos.filter((todo) => (todo as Record<string, unknown> | null)?.status === "completed").length
      return {
        target: todos.length ? plural(todos.length, "item") : undefined,
        result: todos.length ? `${done} done` : undefined,
        opens: true,
      }
    }
    case "question": {
      const asked = Array.isArray(input.questions) ? (input.questions[0] as Record<string, unknown> | null) : null
      return { target: first(text(asked?.question)), opens: true }
    }
    case "skill":
      return { target: text(input.name), opens: false }
    case "execute": {
      const calls = executeCalls(part.state.status === "streaming" ? undefined : metadata.toolCalls)
      return { target: calls.length ? plural(calls.length, "call") : undefined, opens: true }
    }
    default:
      return { target: primitiveInputSummary(input).replace(/\s+/g, " ") || undefined, opens: true }
  }
}

/** Whether a step's permission is being asked for now. */
function useAsked(part: () => SessionMessageAssistantTool) {
  const ctx = use()
  const data = useData()
  const local = useLocal()
  return createMemo(() => {
    if (local.permission.mode === "autoaccept") return false
    const request = data.session.permission.list(ctx.sessionID)?.[0]
    return request?.source?.type === "tool" && request.source.id === part().id
  })
}

export function HamzadToolStep(props: { part: SessionMessageAssistantTool; detail: () => JSX.Element }) {
  const theme = useTheme()
  const renderer = useRenderer()
  const paths = usePathFormatter()
  const asked = useAsked(() => props.part)
  const kind = () => toolDisplay(props.part.name)
  // A question and its answers are part of the conversation, so they stay open.
  const [open, setOpen] = createSignal(kind() === "question")
  const [hover, setHover] = createSignal(false)
  const line = createMemo(() => describe(props.part, (value) => paths.format(value)))
  const running = () => props.part.state.status === "running" || props.part.state.status === "streaming"
  const failed = () => props.part.state.status === "error"
  const error = createMemo(() => (props.part.state.status === "error" ? stripAnsi(props.part.state.error.message) : ""))
  // Upstream draws an unknown tool as one line too: its input and output are shown here instead.
  const own = () => line().opens && kind() !== "generic"
  const opens = () => line().opens || failed()
  const mark = (): RGBA => {
    if (failed()) return theme.text.feedback.error.base
    if (asked()) return theme.text.feedback.warning.base
    return hover() && opens() ? theme.text.base : theme.text.muted
  }
  const name = createMemo(() => props.part.name.toLowerCase())
  return (
    <box flexShrink={0} paddingLeft={STEP_INDENT}>
      <box
        flexDirection="row"
        gap={1}
        minWidth={0}
        onMouseOver={() => opens() && setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => {
          if (renderer.getSelection()?.getSelectedText()) return
          if (opens()) setOpen((value) => !value)
        }}
      >
        <Show
          when={running()}
          fallback={
            <text fg={mark()} flexShrink={0} selectable={false}>
              ◆
            </text>
          }
        >
          <box flexShrink={0} width={1}>
            <Spinner color={asked() ? theme.text.feedback.warning.base : theme.text.muted} />
          </box>
        </Show>
        <text fg={asked() ? theme.text.feedback.warning.base : theme.text.base} flexShrink={0} wrapMode="none">
          {name().padEnd(6)}
        </text>
        <text fg={theme.text.muted} flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate>
          {line().target ?? ""}
        </text>
        <Show when={failed() ? "failed" : line().result}>
          {(result) => (
            <text
              fg={failed() || line().bad ? theme.text.feedback.error.base : theme.text.muted}
              flexShrink={0}
              wrapMode="none"
            >
              {result()}
            </text>
          )}
        </Show>
      </box>
      <Show when={open()}>
        <Show when={own()} fallback={<Generic part={props.part} error={error()} />}>
          <box marginTop={1}>{props.detail()}</box>
        </Show>
      </Show>
    </box>
  )
}

/** What a step was given and what it gave back, for a step upstream draws as one line too. */
function Generic(props: { part: SessionMessageAssistantTool; error: string }) {
  const theme = useTheme()
  const input = createMemo(() =>
    Object.entries(typeof props.part.state.input === "string" ? {} : (props.part.state.input ?? {})),
  )
  const output = createMemo(() =>
    stripAnsi(
      toolDisplayContent(props.part.state)
        .flatMap((content) => (content.type === "text" ? [content.text] : [content.name ?? content.uri]))
        .join("\n")
        .trim(),
    ),
  )
  return (
    <box paddingLeft={2}>
      <For each={input()}>
        {([key, value]) => (
          <box flexDirection="row">
            <text flexShrink={0} fg={theme.text.muted}>
              {key}:{" "}
            </text>
            <text flexGrow={1} wrapMode="word" fg={theme.text.base}>
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </text>
          </box>
        )}
      </For>
      <Show when={props.error || output()}>
        {(value) => (
          <box flexDirection="row">
            <text flexShrink={0} fg={theme.text.muted}>
              {props.error ? "error: " : "output: "}
            </text>
            <text flexGrow={1} wrapMode="word" fg={props.error ? theme.text.feedback.error.base : theme.text.base}>
              {value()}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}
