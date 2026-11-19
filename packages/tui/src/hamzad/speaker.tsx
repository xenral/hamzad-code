import { Brand } from "@opencode/util/brand"
import type { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { framed } from "./look"

/**
 * Who is speaking, before the first line of what they said: `you ›` or `hamzad ›`, with the
 * following lines kept under the text. Upstream's build shows the words alone.
 */
export function HamzadSpeaker(props: { who: "you" | "hamzad"; muted?: boolean; children: JSX.Element }) {
  if (!framed) return props.children
  const theme = useTheme()
  const color = (): RGBA => (props.muted ? theme.text.muted : props.who === "you" ? theme.text.muted : theme.text.base)
  return (
    <box flexDirection="row" flexShrink={0} minWidth={0}>
      <text fg={color()} flexShrink={0} wrapMode="none" selectable={false}>
        {props.who === "you" ? "you › " : `${Brand.cli} › `}
      </text>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        {props.children}
      </box>
    </box>
  )
}
