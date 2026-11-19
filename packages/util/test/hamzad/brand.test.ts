import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

const brand = pathToFileURL(path.join(import.meta.dir, "../../src/brand.ts")).href
const env = pathToFileURL(path.join(import.meta.dir, "../../src/brand-env.ts")).href
const global = pathToFileURL(path.join(import.meta.dir, "../../src/global.ts")).href

describe("brand", () => {
  test("Hamzad is the default profile and keeps its own directories and port", () => {
    const result = run(
      `const { Brand } = await import(${JSON.stringify(brand)}); const { Global } = await import(${JSON.stringify(global)});` +
        `console.log(JSON.stringify({ id: Brand.id, cli: Brand.cli, port: Brand.port.latest, config: Global.Path.config }))`,
      { XDG_CONFIG_HOME: "/x/config" },
    )
    expect(result).toEqual({ id: "hamzad", cli: "hamzad", port: 0x686d, config: "/x/config/hamzad" })
  })

  test("the upstream profile restores upstream's values", () => {
    const result = run(
      `const { Brand } = await import(${JSON.stringify(brand)}); const { Global } = await import(${JSON.stringify(global)});` +
        `console.log(JSON.stringify({ id: Brand.id, cli: Brand.cli, port: Brand.port.latest, config: Global.Path.config, money: Brand.money.format(1.5) }))`,
      { XDG_CONFIG_HOME: "/x/config", HAMZAD_BRAND: "upstream" },
    )
    expect(result).toEqual({
      id: "upstream",
      cli: "opencode",
      port: 0xc0de,
      config: "/x/config/opencode",
      money: "$1.50",
    })
  })

  test("money is written in credits", () => {
    const result = run(
      `const { Brand } = await import(${JSON.stringify(brand)});` +
        `console.log(JSON.stringify([Brand.money.format(0.031), Brand.money.format(12.5), Brand.money.format(1234.56), Brand.money.fixed(3), Brand.money.rate("1,935")]))`,
    )
    expect(result).toEqual(["0.03 cr", "12.5 cr", "1,235 cr", "3.00 cr", "1,935 cr"])
  })

  test("what is left is always written to the hundredth", () => {
    const result = run(
      `const { Brand } = await import(${JSON.stringify(brand)});` +
        `console.log(JSON.stringify([Brand.money.exact(1200.58), Brand.money.exact(1200), Brand.money.exact(0.04), Brand.money.exact(1234567.5)]))`,
    )
    expect(result).toEqual(["1,200.58 cr", "1,200.00 cr", "0.04 cr", "1,234,567.50 cr"])
  })

  const settings = `console.log(JSON.stringify({ policy: Brand.update.policy, config: Brand.config, client: Brand.client, host: Brand.host, theme: Brand.theme, agents: Brand.agents, tagline: Brand.tagline ?? null }))`

  test("a new version installs itself, the config file may carry this build's name, and servers are told who asks", () => {
    const result = run(`const { Brand } = await import(${JSON.stringify(brand)}); ${settings}`)
    expect(result).toEqual({
      policy: "auto",
      config: { names: ["hamzad.json", "hamzad.jsonc"], file: "hamzad.jsonc" },
      client: { name: "Hamzad", uri: "https://hamzad.ai" },
      host: "hamzad.ai",
      theme: "hamzad",
      agents: { build: "Code" },
      tagline: "your coding twin",
    })
  })

  test("the upstream profile keeps upstream's update policy, config names and client", () => {
    const result = run(`const { Brand } = await import(${JSON.stringify(brand)}); ${settings}`, {
      HAMZAD_BRAND: "upstream",
    })
    expect(result).toEqual({
      policy: "notify",
      config: { names: [], file: "opencode.jsonc" },
      client: {
        name: "opencode",
        uri: "https://opencode.ai",
        logo: "https://opencode.ai/web-app-manifest-512x512.png",
        metadata: "https://opencode.ai/oauth/opencode/client.json",
      },
      host: "opencode.ai",
      theme: "opencode",
      agents: {},
      tagline: null,
    })
  })

  test("every row of a logo half has the same width", () => {
    const result = run(
      `const { Brand } = await import(${JSON.stringify(brand)}); console.log(JSON.stringify(Brand.logo))`,
    )
    for (const half of [result.word.left, result.word.right, result.mark.left, result.mark.right]) {
      expect(half).toHaveLength(4)
      expect(new Set(half.map((line: string) => Array.from(line).length)).size).toBe(1)
    }
  })

  test("the API address can be pointed elsewhere", () => {
    const read = `const { Brand } = await import(${JSON.stringify(brand)}); console.log(JSON.stringify(Brand.api()))`
    expect(run(read)).toBe("https://hamzad.ai/api/v1")
    expect(run(read, { HAMZAD_API_URL: "http://127.0.0.1:4000/api/v1/" })).toBe("http://127.0.0.1:4000/api/v1")
  })
})

describe("brand downloads", () => {
  const read = `const { Brand } = await import(${JSON.stringify(brand)}); console.log(JSON.stringify({ installer: Brand.update.installer, ripgrep: Brand.ripgrep, grammars: Brand.grammars ?? null, catalog: Brand.catalog(), support: Brand.support("2.3.2-hamzad.1").href }))`

  test("the installer, ripgrep and the grammars come from hamzad.ai, and no catalog is loaded", () => {
    expect(run(read)).toEqual({
      installer: "https://hamzad.ai/cli/install",
      ripgrep: "https://hamzad.ai/cli/mirror/rg",
      grammars: "https://hamzad.ai/cli/mirror/ts",
      catalog: false,
      support: "https://hamzad.ai/panel/support?cli=2.3.2-hamzad.1",
    })
  })

  test("HAMZAD_CLI_URL points a build at another copy of the downloads", () => {
    expect(run(read, { HAMZAD_CLI_URL: "http://127.0.0.1:8765/" })).toMatchObject({
      installer: "http://127.0.0.1:8765/install",
      ripgrep: "http://127.0.0.1:8765/mirror/rg",
    })
  })

  test("a catalog the person points at is loaded", () => {
    expect(run(read, { OPENCODE_MODELS_URL: "https://models.example" }).catalog).toBe(true)
  })

  test("the upstream profile fetches from where upstream does", () => {
    expect(run(read, { HAMZAD_BRAND: "upstream" })).toMatchObject({
      installer: "https://opencode.ai/v2/install",
      ripgrep: "https://github.com/BurntSushi/ripgrep/releases/download",
      grammars: null,
      catalog: true,
    })
  })
})

describe("brand environment", () => {
  const read = `await import(${JSON.stringify(env)}); console.log(JSON.stringify({ dir: process.env.OPENCODE_CONFIG_DIR ?? null, db: process.env.OPENCODE_DB ?? null, log: process.env.OPENCODE_LOG_LEVEL ?? null, key: process.env.OPENCODE_API_KEY ?? null }))`

  test("a HAMZAD_ variable is read under the upstream name", () => {
    expect(run(read, { HAMZAD_LOG_LEVEL: "debug", HAMZAD_CONFIG_DIR: "/mine" })).toEqual({
      dir: "/mine",
      db: null,
      log: "debug",
      key: null,
    })
  })

  test("a stock OpenCode location is not followed", () => {
    expect(
      run(read, { OPENCODE_CONFIG_DIR: "/stock", OPENCODE_DB: "/stock/opencode.db", OPENCODE_LOG_LEVEL: "info" }),
    ).toEqual({
      dir: null,
      db: null,
      log: "info",
      key: null,
    })
  })

  test("a location a parent Hamzad process passed on is kept", () => {
    expect(run(read, { HAMZAD_ENV: "1", OPENCODE_DB: "/passed/on.db" }).db).toBe("/passed/on.db")
  })

  test("Hamzad's own key never becomes the upstream service's key", () => {
    expect(run(read, { HAMZAD_API_KEY: "sk-hmz-test" }).key).toBeNull()
  })

  test("the upstream profile leaves the environment alone", () => {
    expect(run(read, { HAMZAD_BRAND: "upstream", OPENCODE_CONFIG_DIR: "/stock", HAMZAD_LOG_LEVEL: "debug" })).toEqual({
      dir: "/stock",
      db: null,
      log: null,
      key: null,
    })
  })
})

function run(script: string, env: Record<string, string> = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry) => !entry[0].startsWith("HAMZAD_") && !entry[0].startsWith("OPENCODE_")),
  )
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    env: { ...inherited, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}
