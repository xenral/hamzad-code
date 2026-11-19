import { Brand } from "@opencode/util/brand"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"

/** One quiet line under the wordmark on the home screen, where the screen has the room. */
export function HamzadTagline() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  return (
    <Show when={Brand.tagline && dimensions().height >= 16}>
      <box alignItems="center">
        <text fg={theme.text.muted} selectable={false}>
          {Brand.tagline}
        </text>
      </box>
    </Show>
  )
}
