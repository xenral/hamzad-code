// Checks that a built binary names upstream nowhere a person can read.
//
//   bun hamzad/script/check-brand.ts packages/cli/dist/cli-linux-x64/bin/hamzad [--show <kind>]
//
// The transform in brand-transform.ts rewrites the name in text. This looks at the result: every
// place the binary still holds the name must be one of the kinds below, each a name another
// program reads, not a person. Anything else is listed and the check fails, so a sentence upstream
// adds, or one the transform's rules miss, is caught before a release instead of by a user.

type Kind = { name: string; why: string; match: (before: string, word: string, after: string) => boolean }

const identifier = /[A-Za-z0-9_$]/
const edge = (char: string) => char === "" || char < " " || char > "~" || "\"'`".includes(char)

// In order: the first kind that fits is the one counted.
const kinds: Kind[] = [
  {
    name: "package scope",
    why: "module names inside the program (`@opencode/core`), never printed",
    match: (before, _word, after) => before.endsWith("@") && /^[/\-[\\]/.test(after),
  },
  {
    name: "setting name",
    why: "variables the program reads; a person sets them as HAMZAD_*, and sentences that name one say so",
    match: (_before, word, after) => word === "OPENCODE" && after.startsWith("_"),
  },
  {
    name: "hosted product",
    why: "upstream's own services (Go, Zen, Console); their plugins are not loaded in this build, so nothing shows these",
    match: (_before, word, after) => word === "OpenCode" && /^ (?:Go|Zen|Console)/.test(after),
  },
  {
    name: "identifier",
    why: "names in the code itself (`OpenCodeEvent`, `opencode2`)",
    match: (before, _word, after) => identifier.test(before.slice(-1)) || identifier.test(after.slice(0, 1)),
  },
  {
    name: "export name",
    why: "the client library's namespace, as the bundler writes it",
    match: (before, word, after) =>
      word === "OpenCode" && (/(?:\bas |[{,])$/.test(before) || /^(?: from |[:},])/.test(after)),
  },
  {
    name: "dotted name",
    why: "ids, file names and hosts (`opencode.tools`, `opencode.json`, `.opencode/`, `opencode.ai`); the config file and folder keep working under upstream's names",
    match: (before, _word, after) => before.endsWith(".") || /^\\?\.[A-Za-z0-9_*]/.test(after),
  },
  {
    name: "wire name or path",
    why: "headers, ids and paths (`x-opencode-session`, `opencode-go`, `/etc/opencode`)",
    match: (before, _word, after) => /[-_:/\\=|[\]]$/.test(before) || /^[-_:/\\=|[\]]/.test(after),
  },
  {
    name: "whole string",
    why: "the bare word as a value: a provider id, the default theme's key, a client name on the wire",
    // `opencode.` whole is the prefix every built-in plugin's id begins with.
    match: (before, _word, after) =>
      edge(before.slice(-1)) && (edge(after.slice(0, 1)) || (after.startsWith(".") && edge(after.slice(1, 2)))),
  },
  {
    name: "another package's text",
    why: "a message inside the GitLab provider's own library, which this build never loads",
    match: (before, _word, after) => before.endsWith("authenticate with '") && after.startsWith(" auth login gitlab"),
  },
]

const file = process.argv[2]
if (!file) {
  console.error("usage: bun hamzad/script/check-brand.ts <binary> [--show <kind>]")
  process.exit(2)
}
// One byte to one character, so offsets are the file's own and nothing fails to decode.
const text = new TextDecoder("latin1").decode(await Bun.file(file).bytes())

// `--show <kind>` prints every distinct place counted under that kind, for reading by eye.
const show = process.argv.includes("--show") ? process.argv[process.argv.indexOf("--show") + 1] : undefined
const shown = new Set<string>()
const around = (start: number) =>
  text
    .slice(Math.max(0, start - 60), start + 70)
    .replace(/[^\x20-\x7e]+/g, " ")
    .trim()

const counts = new Map<string, number>()
const found: string[] = []
for (const hit of text.matchAll(/opencode/gi)) {
  const start = hit.index
  const before = text.slice(Math.max(0, start - 24), start)
  const after = text.slice(start + hit[0].length, start + hit[0].length + 24)
  const kind = kinds.find((item) => item.match(before, hit[0], after))
  if (kind) {
    counts.set(kind.name, (counts.get(kind.name) ?? 0) + 1)
    if (kind.name === show) shown.add(around(start))
    continue
  }
  found.push(around(start))
}

const total = [...counts.values()].reduce((sum, count) => sum + count, 0) + found.length
console.log(`${file}: the name appears ${total} times`)
for (const kind of kinds) {
  const count = counts.get(kind.name) ?? 0
  if (count > 0) console.log(`  ${String(count).padStart(5)}  ${kind.name}: ${kind.why}`)
}
for (const context of shown) console.log(`  … ${context} …`)
if (found.length > 0) {
  console.error(`\n${found.length} place(s) a person could read:`)
  for (const context of new Set(found)) console.error(`  … ${context} …`)
  process.exit(1)
}
console.log("  nowhere a person reads it")
