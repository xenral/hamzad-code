export * as HamzadRunRtl from "./rtl"

// `hamzad run`'s words in a terminal that draws text as it was written: Persian lines read right to
// left with their letters joined, as the interface shows them. Only what goes to a terminal, with the
// interface's `rtl` setting and `HAMZAD_RTL` deciding as they do there; a pipe gets the text as it is.

import { Brand } from "@opencode/util/brand"
import { HamzadRtl } from "@opencode/util/hamzad-rtl"
import { Effect } from "effect"
import { Config } from "../config"

const state = { on: false }

/** Reads the setting, once, before a run prints anything. */
export const configure = Effect.fn("cli.hamzad.rtl.configure")(function* () {
  if (!Brand.isHamzad || !process.stderr.isTTY) return
  const config = yield* Config.Service
  const info = yield* config.get().pipe(Effect.orElseSucceed(() => undefined))
  state.on = HamzadRtl.enabled(info?.rtl, process.env)
})

/** A line for the terminal as it should be written there. */
export function line(text: string) {
  return state.on ? HamzadRtl.text(text, process.stderr.columns) : text
}
