import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Brand } from "@opencode/util/brand"
import { phrases } from "../../../../hamzad/script/brand-phrases"
import { brandPlugin, source, words } from "../../../../hamzad/script/brand-transform"

const sentence = (text: string) => words(text, true)
const word = (text: string) => words(text, false)

describe.skipIf(!Brand.isHamzad)("the name in text a person reads", () => {
  test("the product is named as this build wherever it stands as a word", () => {
    expect(word("OpenCode")).toBe("Hamzad")
    expect(sentence("/update      Update OpenCode")).toBe("/update      Update Hamzad")
    expect(sentence("you'll be prompted to restart OpenCode.")).toBe("you'll be prompted to restart Hamzad.")
    expect(sentence("OpenCode's own settings (OpenCode)")).toBe("Hamzad's own settings (Hamzad)")
  })

  test("names another program reads are left as they are", () => {
    for (const name of [
      "OpenCodeEvent",
      "isOpenCodeEvent",
      "X-OpenCode-Capabilities",
      "OpenCode-User/1.0; +https://opencode.ai",
      "OpenCode.make",
      "Anomaly.OpenCode",
      "@opencode/client",
      "@opencode-ai/plugin",
      "opencode.tools",
      "opencode-go",
      "x-opencode-session",
      "opencode:theme",
      "/etc/opencode",
      "https://opencode.ai/config.json",
      "models.opencode.ai",
      "OPENCODE_CONFIG",
      "opencode",
      "opencode.json",
    ]) {
      expect(word(name)).toBe(name)
    }
    expect(sentence("header X-OpenCode-Capabilities from @opencode/client for opencode.tools")).toBe(
      "header X-OpenCode-Capabilities from @opencode/client for opencode.tools",
    )
  })

  test("upstream's hosted products keep their own names", () => {
    for (const text of ["Upgrade to OpenCode Go", "OpenCode Zen models", "Sign in to OpenCode Console"])
      expect(sentence(text)).toBe(text)
  })

  test("the command is this build's where a sentence shows it, and stays an id where it is quoted", () => {
    expect(sentence("then run opencode upgrade again")).toBe("then run hamzad upgrade again")
    expect(sentence("opencode auth login")).toBe("hamzad auth login")
    expect(sentence("Run `opencode mcp add` to add one")).toBe("Run `hamzad mcp add` to add one")
    expect(sentence("tools in the `opencode` namespace")).toBe("tools in the `opencode` namespace")
    expect(sentence('search({ namespace: "opencode" })')).toBe('search({ namespace: "opencode" })')
  })

  test("links to upstream's guide go to this build's", () => {
    expect(sentence("See https://opencode.ai/docs/config#models for more.")).toBe(`See ${Brand.docs} for more.`)
    expect(word("https://opencode.ai/docs/")).toBe(Brand.docs)
  })

  test("a person's own folders and files are named as this build keeps them", () => {
    expect(sentence("lives at ~/.config/opencode/cli.json")).toBe("lives at ~/.config/hamzad/cli.json")
    expect(sentence("or $XDG_CONFIG_HOME/opencode/cli.json when set")).toBe(
      "or $XDG_CONFIG_HOME/hamzad/cli.json when set",
    )
    expect(sentence("defaults to ${XDG_STATE_HOME:-~/.local/state}/opencode/pty")).toBe(
      "defaults to ${XDG_STATE_HOME:-~/.local/state}/hamzad/pty",
    )
    expect(sentence("installed to ~/.opencode/bin")).toBe("installed to ~/.hamzad/bin")
    expect(sentence("check your config (opencode.json) provider names")).toBe(
      "check your config (hamzad.json) provider names",
    )
    expect(sentence("Inspect ~/.local/share/opencode/log/opencode.log")).toBe(
      "Inspect ~/.local/share/hamzad/log/hamzad.log",
    )
    // A project's own folder keeps upstream's name, which is read as before.
    expect(sentence("agents live in .opencode/agents")).toBe("agents live in .opencode/agents")
  })

  test("a setting is named as a person sets it, in a sentence only", () => {
    expect(sentence("set OPENCODE_DISABLE_AUTOUPDATE=1 to turn it off")).toBe(
      "set HAMZAD_DISABLE_AUTOUPDATE=1 to turn it off",
    )
    expect(word("OPENCODE_DISABLE_AUTOUPDATE")).toBe("OPENCODE_DISABLE_AUTOUPDATE")
  })

  test("upstream's site under a card is this build's; an address is not", () => {
    expect(word("opencode.ai")).toBe("hamzad.ai")
    expect(word("https://opencode.ai")).toBe("https://opencode.ai")
    expect(word("https://opencode.ai/theme.json")).toBe("https://opencode.ai/theme.json")
  })
})

describe.skipIf(!Brand.isHamzad)("the name in a source file", () => {
  test("only text changes: not an import, an identifier, a comment or a pattern", async () => {
    const code = [
      'import { OpenCode } from "@opencode/client"',
      "// OpenCode stays in a comment",
      "const OpenCodeEvent = /OpenCode/",
      'export const title = "Update OpenCode"',
      "export const say = (version: string) => `OpenCode ${version} is ready, run opencode to use it`",
      "export const between = (a: string, b: string) => `${a} opencode ${b}`",
      'export const id = "opencode"',
      'export const header = { "x-opencode-session": OpenCode, event: OpenCodeEvent }',
      "",
    ].join("\n")
    expect(await source(code, "sample.ts")).toBe(
      [
        'import { OpenCode } from "@opencode/client"',
        "// OpenCode stays in a comment",
        "const OpenCodeEvent = /OpenCode/",
        'export const title = "Update Hamzad"',
        "export const say = (version: string) => `Hamzad ${version} is ready, run hamzad to use it`",
        "export const between = (a: string, b: string) => `${a} hamzad ${b}`",
        'export const id = "opencode"',
        'export const header = { "x-opencode-session": OpenCode, event: OpenCodeEvent }',
        "",
      ].join("\n"),
    )
  })

  test("the words inside a component change, and its tags and attributes' names do not", async () => {
    const code = [
      "export function Notice(props: { OpenCode: string }) {",
      '  return <box title="OpenCode is updating">Loading OpenCode {props.OpenCode}</box>',
      "}",
      "",
    ].join("\n")
    expect(await source(code, "notice.tsx")).toBe(
      [
        "export function Notice(props: { OpenCode: string }) {",
        '  return <box title="Hamzad is updating">Loading Hamzad {props.OpenCode}</box>',
        "}",
        "",
      ].join("\n"),
    )
  })

  test("a file that names nothing is returned as it was", async () => {
    const code = 'import { Effect } from "effect"\nexport const id = "opencode.tools"\n'
    expect(await source(code, "plain.ts")).toBe(code)
  })
})

describe.skipIf(!Brand.isHamzad)("the check of a built program", () => {
  const script = path.join(import.meta.dir, "../../../../hamzad/script/check-brand.ts")
  const check = async (contents: string) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hamzad-brand-"))
    const file = path.join(directory, "program")
    await fs.writeFile(file, contents)
    const child = Bun.spawn({ cmd: [process.execPath, script, file], stdout: "pipe", stderr: "pipe" })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    await fs.rm(directory, { recursive: true, force: true })
    return { code, stderr }
  }

  test("passes names only a program reads", async () => {
    const result = await check(
      [
        'import "@opencode/client"',
        "class OpenCodeEvent {}",
        '"x-opencode-session"',
        '"opencode.tools"',
        '"opencode"',
        "process.env.OPENCODE_CONFIG",
        '"https://opencode.ai/theme.json"',
        '"Upgrade to OpenCode Go"',
        '".opencode/agents"',
      ].join("\0"),
    )
    expect(result).toEqual({ code: 0, stderr: "" })
  })

  test("fails, and says where, when a sentence names upstream", async () => {
    const product = await check('"Restart OpenCode to finish"')
    expect(product.code).toBe(1)
    expect(product.stderr).toContain("Restart OpenCode to finish")
    const command = await check('"then run opencode upgrade again"')
    expect(command.code).toBe(1)
    expect(command.stderr).toContain("run opencode upgrade")
  })
})

describe.skipIf(!Brand.isHamzad)("the sentences this build words its own way", () => {
  const root = path.join(import.meta.dir, "../../../..")
  type Load = (args: { path: string }) => Promise<{ contents?: string } | undefined>
  const handlers = (plugin: { setup: (build: never) => unknown }) => {
    const found: { filter: RegExp; load: Load }[] = []
    plugin.setup({
      onLoad: (constraints: { filter: RegExp }, load: Load) => void found.push({ filter: constraints.filter, load }),
      onResolve: () => undefined,
    } as never)
    return found
  }
  const solid = async () =>
    (
      await import(Bun.resolveSync("@opentui/solid/bun-plugin", path.join(root, "packages/tui")))
    ).createSolidTransformPlugin()
  // The file as the program loads it, and as it would without this build's words: a component goes
  // through the JSX compiler first, as in the build.
  const load = async (file: string) => {
    const reworded = (await handlers(brandPlugin({ solid: await solid(), always: true }))[0]!.load({ path: file }))
      ?.contents
    const component = handlers(await solid()).find((item) => /\.tsx$/.test(file) && item.filter.test(file))
    const plain = component ? (await component.load({ path: file }))?.contents : await Bun.file(file).text()
    return { reworded: reworded ?? "", plain: plain ?? "" }
  }
  const count = (text: string, part: string) => text.split(part).length - 1

  for (const phrase of phrases) {
    test(`${phrase.file}: "${phrase.from}"`, async () => {
      const file = ["tsx", "ts"]
        .map((extension) => path.join(root, `${phrase.file}.${extension}`))
        .find((candidate) => Bun.file(candidate).size > 0)
      expect(file, "the file is still there").toBeDefined()
      const original = await Bun.file(file!).text()
      // Upstream still says it: a merge that reworded it must reword this entry too.
      expect(original).toContain(phrase.from)
      const loaded = await load(file!)
      expect(count(loaded.reworded, phrase.to)).toBeGreaterThan(count(loaded.plain, phrase.to))
    })
  }
})
