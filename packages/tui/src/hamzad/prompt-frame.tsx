import { Brand } from "@opencode/util/brand"
import type { BoxRenderable, RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { contextUsage, formatContextUsage } from "../util/session"
import { left as credits } from "./balance"
import { fitEdge, useFolder, type EdgeItem } from "./folder"
import { Edge, narrow, Sides } from "./frame"
import { own } from "./look"

/**
 * The prompt in a rounded frame, with a line of room above and below what is typed. Its top edge
 * names the mode and the model, or, with no model, why there is none. Its bottom edge carries the
 * folder on its left and, on its right, the credits left and the menu's key, or, while an answer is
 * being written, a spinner and how to stop it. Upstream's build gets its prompt as it was.
 */
export function HamzadPromptFrame(props: {
  children: JSX.Element
  /** The mode and its colour, the model and its provider, as the prompt names them. */
  agent?: string
  color?: RGBA
  model: string
  provider: string
  variant?: string
  /** Whether a model is chosen; without one, `model` and `provider` say why not. */
  chosen: boolean
  shell: boolean
  running: boolean
  /** Whether esc was pressed once already, so the next one stops the answer. */
  armed: boolean
  /** The folder the next session starts in, while there is no session; a session's own is used in one. */
  folder?: string
  sessionID?: string
}) {
  if (!own) return props.children
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const menu = Keymap.useShortcut("command.palette.show")
  const data = useData()
  const work = useWork(() => props.sessionID)
  // The session's folder, which stays put while an answer is written, unlike upstream's line under the prompt.
  const where = useFolder(() => (props.sessionID ? data.session.get(props.sessionID)?.location : undefined))
  // The frame's own width, which is less than the window's beside the sidebar or on the home screen.
  const [width, setWidth] = createSignal(dimensions().width)
  // What the bottom edge says, in order. When it is short of room the context figure goes first, then
  // the counts, then the menu's key; the credits stay, and the folder is shortened to what is left.
  const edge = createMemo(() => {
    const credit = credits() === undefined ? undefined : Brand.money.exact(credits()!)
    const items = [
      { text: work().counts, drop: 2 },
      { text: work().context, drop: 1 },
      ...(props.running
        ? [{ text: props.armed ? "⠿ esc again to stop" : "⠿ esc to stop", drop: 0 }]
        : [
            { text: credit, drop: 0 },
            { text: menu() ? `${menu()} menu` : undefined, drop: 3 },
          ]),
    ].filter((item): item is EdgeItem => Boolean(item.text))
    const folder = props.sessionID ? where() : props.folder
    return fitEdge({ width: width(), ends: narrow(dimensions().width) ? 2 : 4, folder, items })
  })
  const folder = () => edge().folder
  const status = () => edge().status
  const title = () => {
    if (props.shell) return [{ text: "Shell", fg: props.color ?? theme.text.base }]
    if (!props.chosen) return [{ text: `${props.model} · ${props.provider}`, fg: theme.text.feedback.warning.base }]
    if (!props.agent) return []
    return [
      { text: props.agent, fg: props.color ?? theme.text.base },
      { text: ` · ${props.model}${props.variant ? ` · ${props.variant}` : ""}`, fg: theme.text.base },
    ]
  }
  return (
    <box
      width="100%"
      flexShrink={0}
      onSizeChange={function (this: BoxRenderable) {
        const measured = this.width
        queueMicrotask(() => setWidth(measured))
      }}
    >
      <Edge
        side="top"
        left={
          <Show when={title().length > 0}>
            <text wrapMode="none" truncate flexShrink={1} minWidth={0}>
              {title().map((piece) => (
                <span style={{ fg: piece.fg }}>{piece.text}</span>
              ))}
            </text>
          </Show>
        }
      />
      {/* The caret takes the column of the right-hand padding, so the input is as wide as upstream's. */}
      <Sides tight roomy>
        {props.children}
      </Sides>
      <Edge
        side="bottom"
        bare
        left={
          folder() ? (
            <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
              {` ${folder()} `}
            </text>
          ) : undefined
        }
        right={
          <Show
            when={props.running}
            fallback={
              <text fg={theme.text.muted} wrapMode="none">
                {status().join(" · ")}
              </text>
            }
          >
            {/* While an answer is written the stop key takes the credits' place, behind a live spinner. */}
            <box flexDirection="row">
              <Show when={status().length > 1}>
                <text fg={theme.text.muted} wrapMode="none">
                  {`${status().slice(0, -1).join(" · ")} · `}
                </text>
              </Show>
              <box flexShrink={0} width={1}>
                <Spinner color={props.color ?? theme.text.muted} />
              </box>
              <text fg={props.armed ? theme.text.feedback.warning.base : theme.text.muted} wrapMode="none">
                {props.armed ? " esc again to stop" : " esc to stop"}
              </text>
            </box>
          </Show>
        }
      />
    </box>
  )
}

/** `❯ ` before the input, or `$ ` in shell mode. Upstream's build has the input alone. */
export function HamzadCaret(props: { shell: boolean; color?: RGBA; children: JSX.Element }) {
  if (!own) return props.children
  const theme = useTheme()
  return (
    <box flexDirection="row" width="100%" minWidth={0}>
      <text fg={props.color ?? theme.text.muted} flexShrink={0} selectable={false}>
        {props.shell ? "$ " : "❯ "}
      </text>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        {props.children}
      </box>
    </box>
  )
}

/**
 * What the session has going on besides the answer, as the old line under the prompt showed it:
 * how many agents and background shells are running, and how much of the model's context is used.
 */
function useWork(sessionID: () => string | undefined) {
  const data = useData()
  return createMemo(() => {
    const id = sessionID()
    if (!id) return { counts: undefined, context: undefined }
    const session = data.session.get(id)
    const agents = data.session
      .family(id)
      .filter((item) => item !== id && data.session.status(item) === "running").length
    const shells = data.shell.list(session?.location).filter((shell) => shell.metadata.sessionID === id).length
    const usage = session
      ? contextUsage(
          data.session.message.list(id),
          data.location.model.list(session.location),
          session.revert?.messageID,
        )
      : undefined
    const counts = [
      agents ? `${agents} ${agents === 1 ? "agent" : "agents"}` : undefined,
      shells ? `${shells} ${shells === 1 ? "shell" : "shells"}` : undefined,
    ].filter(Boolean)
    return {
      counts: counts.length ? counts.join(" · ") : undefined,
      context: usage ? formatContextUsage(usage.tokens, usage.percent) : undefined,
    }
  })
}
