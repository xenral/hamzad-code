import type { BunPlugin } from "bun"
import { Brand } from "../../packages/util/src/brand"

const hosts = ["github.com", "raw.githubusercontent.com"]

/** The grammar list with each address moved to the mirror, host and path kept. */
export function rewrite(source: string, mirror: string) {
  const moved = hosts.reduce((text, host) => text.replaceAll(`https://${host}/`, `${mirror}/${host}/`), source)
  // A list upstream moved elsewhere would otherwise ship pointing at hosts the mirror does not cover.
  if (moved === source) throw new Error("the grammar list names none of the mirrored hosts")
  const left = moved.match(/https:\/\/(?!hamzad\.ai\/)[^"'\s]+/g) ?? []
  if (left.length > 0) throw new Error(`the grammar list names hosts the mirror does not cover: ${left.join(", ")}`)
  return moved
}

/**
 * Points the interface's syntax grammars at Hamzad's copy of them when the binary is built.
 * GitHub is slow or unreachable for many of the people this build is for.
 */
export const mirrorPlugin: BunPlugin = {
  name: "hamzad-mirrors",
  setup(build) {
    const mirror = Brand.grammars
    if (!mirror) return
    build.onLoad({ filter: /tui[/\\]src[/\\]parsers-config\.ts$/ }, async (args) => ({
      contents: rewrite(await Bun.file(args.path).text(), mirror),
      loader: "ts",
    }))
  },
}
