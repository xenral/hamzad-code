// Rewrites the product's name in the text a person reads.
//
// Upstream names itself in several hundred sentences across some 140 files: messages, help, pages,
// prompts. Editing them by hand would turn every merge into a conflict, so nothing is edited: this
// transform rewrites the name as the sources are loaded, when the binary is bundled and when the
// CLI runs from source or under test. Only text is touched (string literals, template text, JSX
// text, and the prompt and skill files imported as text), never an identifier, an import, a
// header or any other name another program reads.
//
// It is switched off under `HAMZAD_BRAND=upstream`, where upstream's tests expect upstream's words.

import type { BunPlugin } from "bun"
import { Brand } from "../../packages/util/src/brand"

// What is rewritten, most specific first. Each rule says what it must not touch.

// Links to upstream's guide. Other addresses on that host are schemas and services, not reading.
const docs = /https:\/\/opencode\.ai\/docs[^\s"'`)\]>\\]*/g

// The per-user directories, which this build names after itself, written out or by the variable
// that moves them. A project's own `.opencode/` folder keeps its name, so the home-folder one is
// recognised by what comes before it.
const userDirectory = /((?:\.config|\.local\/share|\.local\/state|\.cache|XDG_[A-Z]+_HOME)\}?\/)opencode(?![\w.-])/g
const homeDirectory = /((?:~|\$HOME|\$\{HOME\})\/)\.opencode(?![\w-])/g

// The config file, where a sentence names it: both names are read, and the build's own is the one
// to say. And the log file, which is written under the build's name.
const ownFile = /(?<![\w-])opencode(\.jsonc?|\.log)(?!\w)/g

// Upstream's site, written bare as a signature under a card. An address with a scheme or a path is
// a link or a service and is left alone, apart from the guide above.
const signature = /(?<![\w./@:-])opencode\.ai(?![\w./:-])/g

// The product as a word. Not inside an identifier (`OpenCodeEvent`, `getOpenCodeTheme`), a header
// or agent string (`X-OpenCode-Capabilities`, `OpenCode-User/1.0`), a dotted name (`OpenCode.make`,
// `Anomaly.OpenCode`) or a path. Upstream's hosted products keep their own names: this build
// neither offers nor reaches them, and calling them Hamzad's would be untrue.
const product = /(?<![A-Za-z0-9_.\-/@$])OpenCode(?![A-Za-z0-9_\-/])(?!\.[A-Za-z_$])(?! (?:Go|Zen|Console)\b)/g

// The command, where a sentence shows it. Not a package scope (`@opencode/…`), a file or host
// (`opencode.json`, `opencode.ai`), an id (`opencode.tools`, `opencode-go`, `opencode:x`), a path,
// or the bare word between quotes, which is an id being quoted rather than something to type.
const command = /(?<![\w@./\-:$])opencode(?![\w/\-:@])(?!\.\w)/g
const quotes = new Set(["'", '"', "`"])

// A setting, where a sentence tells a person to set it. The program goes on reading upstream's
// names; every one of them is also read under this build's prefix.
const variable = /(?<![A-Za-z0-9_])OPENCODE_(?=[A-Z0-9])/g

/**
 * The text with the product's name rewritten. `sentence` says the text is something a person reads
 * as a sentence or a command line (it has a space in it); a lone word is an id unless it is the
 * capitalised name.
 */
export function words(text: string, sentence: boolean) {
  const named = text
    .replace(docs, Brand.docs)
    .replace(userDirectory, `$1${Brand.app}`)
    .replace(homeDirectory, `$1${Brand.dot}`)
    .replace(signature, Brand.host)
    .replace(product, Brand.name)
  if (!sentence) return named
  return named
    .replace(variable, `${Brand.cli.toUpperCase()}_`)
    .replace(ownFile, `${Brand.cli}$1`)
    .replace(command, (match, offset: number, whole: string) =>
      quotes.has(whole[offset - 1] ?? "") && quotes.has(whole[offset + match.length] ?? "") ? match : Brand.cli,
    )
}

// A cheap look at a whole file: most name the product only in their imports and need no parsing.
const candidate =
  /OpenCode(?![A-Za-z0-9_])|opencode\.ai\/docs|(?<![\w@./\-:$])opencode(?![\w/\-:@])|[\w}]\/opencode|\/\.opencode|OPENCODE_[A-Z]/

/** Whether a source file may hold text to rewrite. */
export const mentions = (code: string) => candidate.test(code)

const space = /\s/

/** A TypeScript or JavaScript source with the name rewritten inside its text, and nowhere else. */
export async function source(code: string, file: string) {
  if (!mentions(code)) return code
  const { default: ts } = await import("typescript")
  const kind = /\.[cm]?[jt]sx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.[cm]?js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, kind)
  const edits: { start: number; end: number; text: string }[] = []
  const edit = (node: { getStart: (file: typeof parsed) => number; end: number }, sentence: boolean) => {
    const start = node.getStart(parsed)
    const before = code.slice(start, node.end)
    const after = words(before, sentence)
    if (after !== before) edits.push({ start, end: node.end, text: after })
  }
  const visit = (node: import("typescript").Node): void => {
    // A template is one piece of text with holes in it: a lone word between two holes is part of
    // the sentence around it.
    if (ts.isTemplateExpression(node)) {
      const pieces = [node.head, ...node.templateSpans.map((span) => span.literal)]
      const sentence = pieces.some((piece) => space.test(piece.text))
      pieces.forEach((piece) => edit(piece, sentence))
      node.templateSpans.forEach((span) => visit(span.expression))
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return edit(node, space.test(node.text))
    if (ts.isJsxText(node)) return edit(node, true)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return edits
    .toSorted((a, b) => b.start - a.start)
    .reduce((text, item) => text.slice(0, item.start) + item.text + text.slice(item.end), code)
}

// The sources the binary is built from, and nothing installed from a registry.
const sources = /^(?!.*[/\\]node_modules[/\\]).*[/\\]packages[/\\].*[/\\]src[/\\].*\.(?:[cm]?[jt]sx?|txt|md)$/
// Files other build steps replace whole; what they put there is not upstream's text.
const replaced = /(?:parsers-config|pty-binding|watcher-binding|runtime-modules)\.ts$|models-dev[/\\]snapshot\.txt$/

type Loaded =
  | { contents: string; loader: "js" | "ts" | "tsx" | "text" }
  // A running process has no loader for plain text, so the text is handed over as the module itself.
  | { exports: { default: string }; loader: "object" }
type Load = (args: { path: string }) => Promise<Loaded | undefined> | Loaded | undefined

/**
 * The transform as a Bun plugin.
 *
 * `solid` is the plugin that turns the interface's JSX into calls: it must still do that, so its
 * work is done here first and the name rewritten in what it returns. A build therefore lists this
 * plugin twice: for `components` ahead of the JSX plugin, and for the other `sources` after every
 * plugin that replaces a file or only watches which files go by, so each of those still sees its own.
 * `always` is for a running process, where one plugin answers for every file it is asked about;
 * a build lets it pass a file on by answering nothing.
 */
export function brandPlugin(
  options: { solid?: BunPlugin; always?: boolean; only?: "components" | "sources" } = {},
): BunPlugin {
  return {
    name: "hamzad-brand",
    setup(build) {
      if (!Brand.isHamzad) return
      const jsx: { filter: RegExp; load: Load }[] = []
      // Collects what the JSX plugin would register, without registering it a second time.
      void options.solid?.setup({
        ...build,
        onLoad: (constraints: { filter: RegExp }, load: Load) => void jsx.push({ filter: constraints.filter, load }),
        onResolve: () => undefined,
      } as never)
      const component = (file: string) => jsx.find((item) => /\.[cm]?[jt]sx$/.test(file) && item.filter.test(file))

      const text = (contents: string): Loaded =>
        options.always ? { exports: { default: contents }, loader: "object" } : { contents, loader: "text" }

      build.onLoad({ filter: sources }, async (args): Promise<Loaded | undefined> => {
        const jsxFile = /\.[cm]?[jt]sx$/.test(args.path)
        if (options.only && (options.only === "components") !== jsxFile) return undefined
        const prose = /\.(?:txt|md)$/.test(args.path)
        if (replaced.test(args.path)) {
          if (!options.always) return undefined
          const untouched = await Bun.file(args.path).text()
          return prose ? text(untouched) : { contents: untouched, loader: loader(args.path) }
        }
        if (prose) return text(words(await Bun.file(args.path).text(), true))
        const transformed = await component(args.path)?.load({ path: args.path })
        if (transformed && "contents" in transformed)
          return {
            contents: await source(transformed.contents, args.path.replace(/\.[cm]?[jt]sx$/, ".js")),
            loader: "js",
          }
        const code = await Bun.file(args.path).text()
        if (!options.always && !mentions(code)) return undefined
        return { contents: await source(code, args.path), loader: loader(args.path) }
      })
    },
  }
}

const loader = (file: string) =>
  /\.[cm]?[jt]sx$/.test(file) ? ("tsx" as const) : /\.[cm]?js$/.test(file) ? ("js" as const) : ("ts" as const)
