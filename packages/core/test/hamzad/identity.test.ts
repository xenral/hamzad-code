import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import path from "path"
import { HamzadIdentity } from "@opencode/core/hamzad/identity"
import { HamzadPlugins } from "@opencode/core/hamzad/index"
import { PluginInternal } from "@opencode/core/plugin/internal"
import { Brand } from "@opencode/util/brand"

const source = path.join(import.meta.dir, "../../src")

describe.skipIf(!Brand.isHamzad)("HamzadIdentity", () => {
  test("names this build in every upstream prompt that names the harness", async () => {
    const files = [
      path.join(source, "session/runner/prompt/system.txt"),
      ...(await Array.fromAsync(
        new Glob("*.txt").scan({ cwd: path.join(source, "plugin/system-prompt"), absolute: true }),
      )),
    ]
    const prompts = await Promise.all(files.map(async (file) => ({ file, text: await Bun.file(file).text() })))
    const named = prompts.filter((prompt) => /^You are\b/.test(prompt.text))
    // A prompt upstream adds or rewords must still open with a sentence this rename recognises.
    expect(named.length).toBeGreaterThanOrEqual(5)
    for (const prompt of named) {
      const first = HamzadIdentity.rename(prompt.text).split("\n")[0]
      expect(first, prompt.file).toContain("Hamzad CLI")
      expect(first, prompt.file).not.toMatch(/opencode/i)
    }
  })

  test("leaves the rest of a prompt, and prompts that name nothing, as they are", () => {
    expect(HamzadIdentity.rename("You are OpenCode, an agent.\n\nOpenCode Specifics stay.")).toBe(
      "You are Hamzad CLI, an agent.\n\nOpenCode Specifics stay.",
    )
    expect(HamzadIdentity.rename("# Code comments\nMention opencode later.")).toBe(
      "# Code comments\nMention opencode later.",
    )
  })

  test("names the command-line program where the build has already written its own short name", () => {
    expect(HamzadIdentity.rename("You are Hamzad, an agent.\nHamzad stays.")).toBe(
      "You are Hamzad CLI, an agent.\nHamzad stays.",
    )
    expect(HamzadIdentity.rename("You are Hamzad CLI, an agent.")).toBe("You are Hamzad CLI, an agent.")
  })
})

describe.skipIf(!Brand.isHamzad)("HamzadPlugins.arrange", () => {
  const plugin = (id: string): PluginInternal.InternalPlugin => ({
    id,
    effect: () => {
      throw new Error("unused")
    },
  })
  const upstream = [
    plugin("opencode.plan"),
    plugin("opencode.provider.opencode"),
    plugin("opencode.provider.openai"),
    plugin("opencode.provider.ollama"),
    plugin("opencode.tools"),
  ]

  test("drops other hosted providers, keeps local hosts, and runs Hamzad's plugins last", () => {
    expect(HamzadPlugins.arrange(upstream).map((item) => item.id)).toEqual([
      "opencode.plan",
      "opencode.provider.ollama",
      "opencode.tools",
      "hamzad.provider",
      "hamzad.identity",
    ])
  })

  test("HAMZAD_UPSTREAM_PROVIDERS brings them back", () => {
    process.env.HAMZAD_UPSTREAM_PROVIDERS = "1"
    try {
      expect(HamzadPlugins.arrange(upstream).map((item) => item.id)).toEqual([
        ...upstream.map((item) => item.id),
        "hamzad.provider",
        "hamzad.identity",
      ])
    } finally {
      delete process.env.HAMZAD_UPSTREAM_PROVIDERS
    }
  })
})
