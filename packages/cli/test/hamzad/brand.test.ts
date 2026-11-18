import { describe, expect, test } from "bun:test"
import { Brand } from "@opencode/util/brand"
import { rewrite } from "../../../../hamzad/script/mirror-plugin"
import { Commands } from "../../src/commands/commands"
import { ServiceConfig } from "../../src/services/service-config"

describe.skipIf(!Brand.isHamzad)("Hamzad's CLI", () => {
  test("the background service has its own port, apart from a stock OpenCode install", () => {
    expect(ServiceConfig.defaultPort("latest", "linux")).toBe(0x686d)
    expect(ServiceConfig.defaultPort("local", "linux")).toBe(0x686e)
    // Below the range Windows reserves, so the port is the same there.
    expect(ServiceConfig.defaultPort("latest", "win32")).toBe(0x686d)
  })

  test("the command is named hamzad", () => {
    expect(Commands.name).toBe("hamzad")
  })

  test("updates and the installer come from hamzad.ai", () => {
    expect(
      Brand.update.release({ channel: "latest", artifact: "cli", distribution: "npm", current: "2.3.2-hamzad.1" }),
    ).toBe("https://hamzad.ai/cli/latest.json?current=2.3.2-hamzad.1")
    expect(Brand.update.installer).toBe("https://hamzad.ai/cli/install")
    expect(Brand.update.package.test("@hamzad/cli")).toBe(true)
    expect(Brand.update.package.test("@opencode/cli")).toBe(false)
  })
})

describe("the grammar mirror", () => {
  const mirror = "https://hamzad.ai/cli/mirror/ts"

  test("moves every address to the mirror, keeping host and path", () => {
    expect(
      rewrite(
        [
          'wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",',
          '"https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/locals.scm",',
        ].join("\n"),
        mirror,
      ),
    ).toBe(
      [
        'wasm: "https://hamzad.ai/cli/mirror/ts/github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",',
        '"https://hamzad.ai/cli/mirror/ts/raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/locals.scm",',
      ].join("\n"),
    )
  })

  test("covers the grammar list as upstream has it today", async () => {
    const source = await Bun.file(new URL("../../../tui/src/parsers-config.ts", import.meta.url)).text()
    expect(rewrite(source, mirror)).not.toMatch(/https:\/\/(?:raw\.)?github/)
  })

  test("refuses a list that names a host the mirror does not cover", () => {
    expect(() => rewrite('"https://github.com/a/b.wasm", "https://example.com/c.scm"', mirror)).toThrow("example.com")
  })
})
