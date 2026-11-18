export * as Brand from "./brand.js"

// Everything that tells this build apart from upstream OpenCode: names, directories, ports,
// addresses and how money is written. Upstream's own files read these values instead of their
// literals, so each edit there is a one-token substitution that survives a merge.
//
// `HAMZAD_BRAND=upstream` restores upstream's values. Upstream's test suite runs with it against
// the patched tree, which proves the edits are pure indirection.

interface Profile {
  readonly id: "hamzad" | "upstream"
  /** Directory name under the XDG roots and the temp directory. */
  readonly app: string
  /** The command people type. */
  readonly cli: string
  /** How the product is named in text. */
  readonly name: string
  /** Directory in the home folder that holds the installed binary and plan files. */
  readonly dot: string
  /** First segment of the User-Agent. */
  readonly agent: string
  /** Short prefix of the terminal title while a session is open. */
  readonly tag: string
  /** Ports of the managed background service, by release channel. */
  readonly port: { readonly latest: number; readonly local: number }
  readonly docs: string
  /** Scope of the npm packages a build is published under. */
  readonly scope: string
  readonly update: {
    /** The npm package name a global npm install carries. */
    readonly package: RegExp
    readonly installer: string
    readonly release: (input: { channel: string; artifact: string; distribution: string; current: string }) => string
  }
  /** Where ripgrep's release archives are fetched from; the pinned checksums stay upstream's. */
  readonly ripgrep: string
  readonly money: {
    /** A spent amount. */
    readonly format: (value: number) => string
    /** A spent amount with two decimals, for tables. */
    readonly fixed: (value: number) => string
    /** A price per million tokens; `value` is already rounded for display. */
    readonly rate: (value: string) => string
  }
  readonly logo: {
    readonly word: { readonly left: readonly string[]; readonly right: readonly string[] }
    readonly mark: { readonly left: readonly string[]; readonly right: readonly string[] }
  }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

const upstream: Profile = {
  id: "upstream",
  app: "opencode",
  cli: "opencode",
  name: "OpenCode",
  dot: ".opencode",
  agent: "opencode",
  tag: "OC",
  port: { latest: 0xc0de, local: 0xc0df },
  docs: "https://opencode.ai/docs",
  scope: "@opencode",
  update: {
    package: /^@opencode(?:-ai)?\/cli(?:-node)?$/,
    installer: "https://opencode.ai/v2/install",
    release: (input) =>
      `https://opencode.ai/update/api/${encodeURIComponent(input.channel)}/${encodeURIComponent(input.artifact)}/${input.distribution}?current=${encodeURIComponent(input.current)}`,
  },
  ripgrep: "https://github.com/BurntSushi/ripgrep/releases/download",
  money: {
    format: (value) => usd.format(value),
    fixed: (value) => `$${value.toFixed(2)}`,
    rate: (value) => `$${value}`,
  },
  logo: {
    word: {
      left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
      right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
    },
    mark: {
      left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
      right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
    },
  },
}

// Credits are counted in fractions of one, so small amounts keep two decimals and large ones lose them.
const credits = (value: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 }).format(value)} cr`

const site = "https://hamzad.ai"

const hamzad: Profile = {
  id: "hamzad",
  app: "hamzad",
  cli: "hamzad",
  name: "Hamzad",
  dot: ".hamzad",
  agent: "hamzad",
  tag: "HZ",
  // "hm" in ASCII. Below 32768, so Windows needs no remapping, and apart from upstream's 0xC0DE,
  // so both tools run side by side.
  port: { latest: 0x686d, local: 0x686e },
  docs: `${site}/cli`,
  scope: "@hamzad",
  update: {
    package: /^@hamzad\/cli(?:-node)?$/,
    installer: `${site}/cli/install`,
    // A static file per channel; the query is ignored by the host and kept for its logs.
    release: (input) =>
      `${site}/cli/${encodeURIComponent(input.channel)}.json?current=${encodeURIComponent(input.current)}`,
  },
  ripgrep: `${site}/cli/mirror/rg`,
  money: {
    format: credits,
    fixed: (value) => `${value.toFixed(2)} cr`,
    rate: (value) => `${value} cr`,
  },
  logo: {
    word: {
      left: ["▄              ", "█▀▀▄ █▀▀█ █▀█▀█", "█__█ █^^█ █_█_█", "▀~~▀ ▀~~▀ ▀~▀~▀"],
      right: ["             ▄", "▀▀▀█ █▀▀█ █▀▀█", " ▄▀  █^^█ █__█", "█▄▄▄ ▀~~▀ ▀▀▀▀"],
    },
    mark: {
      left: ["▄   ", "█▀▀▄", "█__█", "▀~~▀"],
      right: ["    ", "▀▀▀█", " ▄▀ ", "█▄▄▄"],
    },
  },
}

const profile = typeof process !== "undefined" && process.env.HAMZAD_BRAND === "upstream" ? upstream : hamzad

export const id = profile.id
export const app = profile.app
export const cli = profile.cli
export const name = profile.name
export const dot = profile.dot
export const agent = profile.agent
export const tag = profile.tag
export const port = profile.port
export const docs = profile.docs
export const scope = profile.scope
export const update = profile.update
export const ripgrep = profile.ripgrep
export const money = profile.money
export const logo = profile.logo

/** Whether this is the Hamzad build, as opposed to upstream's values under test. */
export const isHamzad = profile.id === "hamzad"

/** The Hamzad API every gateway, sign-in and balance request goes to. */
export function api() {
  return (process.env.HAMZAD_API_URL || `${site}/api/v1`).replace(/\/+$/, "")
}

/** Where a person adds credits. */
export const billing = `${site}/panel/billing`

/** Where a crash is reported. It carries the build's version and nothing about the crash itself. */
export function support(version: string) {
  const url = new URL(`${site}/panel/support`)
  url.searchParams.set("cli", version)
  return url
}

/** Whether upstream's model catalog is loaded: only when the person points at one. */
export const catalog = () => !isHamzad || Boolean(process.env.OPENCODE_MODELS_URL || process.env.OPENCODE_MODELS_PATH)
