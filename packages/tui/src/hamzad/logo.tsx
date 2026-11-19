import { CliRenderEvents, RGBA, TextAttributes } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Brand } from "@opencode/util/brand"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"

// The wordmark as one word, painted left to right through the theme's secondary, primary and
// accent colours. Only the letters are drawn: the brand's mark is a picture and is never redrawn.
// A terminal that cannot show any colour it is given gets the primary colour alone.

type Scale = Readonly<Record<number, RGBA>>

/** The colour at `position` (0 to 1) along the stops. */
export function along(stops: readonly RGBA[], position: number) {
  if (stops.length === 1) return stops[0]!
  const scaled = Math.min(Math.max(position, 0), 1) * (stops.length - 1)
  const index = Math.min(Math.floor(scaled), stops.length - 2)
  return tint(stops[index]!, stops[index + 1]!, scaled - index)
}

/** The rows of the word: both halves side by side, or one above the other where there is no room. */
export function rows(width: number) {
  const { left, right } = Brand.logo.word
  if (width < 22) return Brand.logo.mark.left.map((line, index) => `${line} ${Brand.logo.mark.right[index]}`).slice(1)
  if (width < 44) return [...left.slice(1), ...right]
  return left.map((line, index) => `${line} ${right[index]}`)
}

export function HamzadLogo() {
  const theme = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  // Known only once the terminal has answered; until then, and in a terminal that does not say, flat.
  const [rich, setRich] = createSignal(renderer.capabilities?.rgb === true)
  const update = () => setRich(renderer.capabilities?.rgb === true)
  renderer.on(CliRenderEvents.CAPABILITIES, update)
  onCleanup(() => renderer.off(CliRenderEvents.CAPABILITIES, update))

  const lines = createMemo(() => rows(dimensions().width))
  const stops = createMemo(() => {
    const hue = theme.hue as unknown as Record<string, Scale | undefined>
    const primary = theme.hue.interactive[200]!
    if (!rich()) return [primary]
    return [hue.secondary?.[200] ?? theme.hue.accent[300]!, primary, theme.hue.accent[200]!]
  })

  const cell = (char: string, fg: RGBA) => {
    const shadow = tint(theme.background.base, fg, 0.25)
    if (char === "_") return { text: " ", fg, bg: shadow }
    if (char === "^") return { text: "▀", fg, bg: shadow }
    if (char === "~") return { text: "▀", fg: shadow, bg: undefined }
    if (char === ",") return { text: "▄", fg: shadow, bg: undefined }
    return { text: char, fg, bg: undefined }
  }

  const row = (line: string) => {
    const chars = Array.from(line)
    const span = Math.max(1, Math.max(...lines().map((item) => Array.from(item).length)) - 1)
    return chars.map((char, column) => cell(char, along(stops(), column / span)))
  }

  return (
    <Show when={dimensions().height >= 12}>
      <box alignItems="center">
        <For each={lines()}>
          {(line) => (
            <box flexDirection="row">
              <For each={row(line)}>
                {(item) => (
                  <text fg={item.fg} bg={item.bg} attributes={TextAttributes.BOLD} selectable={false}>
                    {item.text}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
        <Show when={Brand.tagline && dimensions().height >= 16}>
          <text fg={theme.text.muted} selectable={false}>
            {Brand.tagline}
          </text>
        </Show>
      </box>
    </Show>
  )
}
