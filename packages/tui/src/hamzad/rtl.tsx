import type { OptimizedBuffer } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { Brand } from "@opencode/util/brand"
import { HamzadRtl } from "@opencode/util/hamzad-rtl"
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { useConfig } from "../config"
import { HamzadRtlFrame } from "./rtl-frame"

/**
 * Persian, Arabic and Hebrew read right to left with their letters joined, in terminals that draw
 * text as it was written, such as VS Code's and Cursor's: every finished frame is laid out before it
 * is written (see `rtl-frame.ts`), and the cursor follows the text typed in the prompt. On with the
 * `rtl` setting at `"on"`, or at `"auto"` (the default) in a terminal known to need it;
 * `HAMZAD_RTL=on|off` decides over both.
 */
export default Plugin.define({
  id: "hamzad.rtl",
  setup(context) {
    if (!Brand.isHamzad) return
    return createRoot((dispose) => setupRtl(context, dispose))
  },
})

function setupRtl(context: Plugin.Context, dispose: () => void) {
  const renderer = context.renderer
  const [setting, setSetting] = createSignal<HamzadRtl.Setting>()
  const [failed, setFailed] = createSignal(false)
  const active = createMemo(() => !failed() && HamzadRtl.enabled(setting(), process.env))

  const pass = (buffer: OptimizedBuffer) => {
    if (!active()) return
    try {
      const state = renderer.getCursorState()
      const cursor = state.visible ? { x: state.x - 1, y: state.y - 1 } : undefined
      const caret = HamzadRtlFrame.paint(buffer, cursor)
      if (caret && cursor && caret.x !== cursor.x) renderer.setCursorPosition(caret.x + 1, caret.y + 1, true)
    } catch {
      // Should laying out ever fail, the text is shown as it was written from then on.
      setFailed(true)
    }
  }
  renderer.addPostProcessFn(pass)

  // The setting is read where the interface's settings are, and followed when the file changes.
  context.ui.slot({
    append: "app",
    render: () => {
      const config = useConfig()
      createEffect(() => setSetting(config.data.rtl))
      return null
    },
  })
  createEffect(on(active, () => renderer.requestRender(), { defer: true }))

  return () => {
    renderer.removePostProcessFn(pass)
    dispose()
  }
}
