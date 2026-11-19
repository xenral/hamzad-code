import { Brand } from "@opencode/util/brand"
import type { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { left as credits } from "./balance"
import { Edge, Sides } from "./frame"
import { framed } from "./look"

/**
 * The prompt in a rounded frame. Its top edge names the mode and the model, or, with no model,
 * why there is none. Its bottom edge carries the credits left and the menu's key, or, while an
 * answer is being written, a spinner and how to stop it; before any session, the folder as well.
 * Upstream's build gets its prompt as it was.
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
  /** The folder the next session starts in, shown while there is no conversation frame. */
  folder?: string
}) {
  if (!framed) return props.children
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const menu = Keymap.useShortcut("command.palette.show")
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
    <box width="100%" flexShrink={0}>
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
      <Sides tight>{props.children}</Sides>
      <Edge
        side="bottom"
        bare
        left={
          props.folder ? (
            <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
              {` ${props.folder} `}
            </text>
          ) : undefined
        }
        right={
          <Show
            when={props.running}
            fallback={
              <text fg={theme.text.muted} wrapMode="none">
                {[
                  credits() !== undefined && dimensions().width >= 44 ? Brand.money.exact(credits()!) : undefined,
                  menu() ? `${menu()} menu` : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </text>
            }
          >
            <box flexDirection="row" gap={1}>
              <box flexShrink={0} width={1}>
                <Spinner color={props.color ?? theme.text.muted} />
              </box>
              <text fg={props.armed ? theme.text.feedback.warning.base : theme.text.muted} wrapMode="none">
                {props.armed ? "esc again to stop" : "esc to stop"}
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
  if (!framed) return props.children
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
