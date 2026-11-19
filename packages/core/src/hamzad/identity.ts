export * as HamzadIdentity from "./identity.js"

// Upstream's prompts and built-in skills speak of OpenCode. This plugin corrects what the model is
// told about the program it runs in, without touching upstream's prompt files. The build's text
// transform already writes this build's name wherever upstream's stood; here the model is told the
// fuller thing, that it is the command-line program and not the whole of Hamzad.

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Brand } from "@opencode/util/brand"
import { Effect } from "effect"
import type { PluginInternal } from "../plugin/internal.js"

// Every upstream prompt names the harness in its first sentence, as "OpenCode" or "opencode", or,
// once the transform has been over it, by this build's short name.
const name = new RegExp(String.raw`\bOpenCode\b|\bopencode\b|\b${Brand.name}\b(?! CLI\b)`)

/** The prompt with the harness named as this build, when its opening sentence names upstream's. */
export function rename(prompt: string) {
  const end = prompt.indexOf("\n")
  const first = end === -1 ? prompt : prompt.slice(0, end)
  if (!first.startsWith("You are") || !name.test(first)) return prompt
  return first.replace(name, `${Brand.name} CLI`) + (end === -1 ? "" : prompt.slice(end))
}

export const Plugin = define({
  id: "hamzad.identity",
  effect: Effect.fn("HamzadIdentity")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        const part = event.system[0]
        if (part) event.system[0] = { ...part, text: rename(part.text) }
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)

    // "report" files GitHub issues against upstream for problems in this build, and "opencode" sends
    // the model to upstream's documentation, whose paths and commands differ here.
    yield* ctx.skill.transform((editor) => {
      editor.remove("report")
      editor.remove("opencode")
    })
  }),
} satisfies PluginInternal.InternalPlugin)
