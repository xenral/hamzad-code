// Turns the built binaries into the files hamzad.ai/cli serves:
//
//   install                                   the installer
//   latest.json                               what the installer and `hamzad upgrade` read
//   v/<version>/hamzad-<target>.tar.gz        one archive per platform, ripgrep inside
//   v/<version>/SHA256SUMS
//   mirror/rg/<ripgrep version>/…             ripgrep's release archives, for a first search with no copy
//   mirror/ts/<host>/<path>                   the syntax grammars the interface fetches
//
//   bun hamzad/script/pack.ts --version 2.3.2-hamzad.1 [--dist packages/cli/dist] [--out dist/hamzad]
//                             [--no-ripgrep] [--no-grammars]
//
// Run on Linux, after `packages/cli/script/build.ts` (and after the macOS binaries are signed).

import { $ } from "bun"
import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import { Brand } from "../../packages/util/src/brand"
import parsers from "../../packages/tui/src/parsers-config"

const root = path.resolve(import.meta.dir, "../..")
const option = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const version = option("--version")
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error("pass --version, for example 2.3.2-hamzad.1 (no build metadata: the updater ignores it)")
const dist = path.resolve(root, option("--dist") ?? "packages/cli/dist")
const out = path.resolve(root, option("--out") ?? "dist/hamzad")
const withRipgrep = !process.argv.includes("--no-ripgrep")
const withGrammars = !process.argv.includes("--no-grammars")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

async function download(url: string) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch((error: unknown) => error)
    if (response instanceof Response && response.ok) return new Uint8Array(await response.arrayBuffer())
    if (attempt === 4) throw new Error(`${url}: ${response instanceof Response ? response.status : String(response)}`)
    await Bun.sleep(attempt * 2000)
  }
}

// ripgrep's version, assets and checksums are upstream's own pins, read from the file that
// downloads it at run time, so this script can never ship a different ripgrep than the CLI expects.
const binary = await Bun.file(path.join(root, "packages/core/src/ripgrep/binary.ts")).text()
const ripgrepVersion = /const VERSION = "([^"]+)"/.exec(binary)?.[1]
const ripgrepAssets = new Map(
  Array.from(
    binary.matchAll(
      /"([a-z0-9]+-[a-z0-9]+)": \{\s*platform: "([^"]+)",\s*extension: "([^"]+)",\s*sha256: "([0-9a-f]{64})"/g,
    ),
    (match) => [match[1], { platform: match[2], extension: match[3], sha256: match[4] }] as const,
  ),
)
if (!ripgrepVersion || ripgrepAssets.size < 6) throw new Error("could not read ripgrep's pins from ripgrep/binary.ts")

async function ripgrepArchive(asset: { platform: string; extension: string; sha256: string }) {
  const name = `ripgrep-${ripgrepVersion}-${asset.platform}.${asset.extension}`
  const file = path.join(out, "mirror", "rg", ripgrepVersion!, name)
  if (!(await Bun.file(file).exists())) {
    const bytes = await download(`https://github.com/BurntSushi/ripgrep/releases/download/${ripgrepVersion}/${name}`)
    if (sha256(bytes) !== asset.sha256) throw new Error(`${name} does not match its pinned checksum`)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, bytes)
  }
  return file
}

await fs.rm(out, { recursive: true, force: true })
const releases = path.join(out, "v", version)
await fs.mkdir(releases, { recursive: true })
const stage = await fs.mkdtemp(path.join(out, ".stage-"))

const builds = (await fs.readdir(dist)).filter((name) => name.startsWith("cli-")).toSorted()
if (builds.length === 0) throw new Error(`no builds in ${dist}`)

for (const build of builds) {
  const target = build.slice("cli-".length)
  const windows = target.startsWith("windows-")
  const name = `${Brand.cli}-${target}`
  const source = path.join(dist, build, "bin", windows ? `${Brand.cli}.exe` : Brand.cli)
  if (!(await Bun.file(source).exists())) throw new Error(`${build} has no ${Brand.cli} binary`)
  const directory = path.join(stage, name)
  await fs.mkdir(path.join(directory, "bin"), { recursive: true })
  await fs.copyFile(source, path.join(directory, "bin", path.basename(source)))
  await fs.chmod(path.join(directory, "bin", path.basename(source)), 0o755)
  await fs.copyFile(path.join(root, "LICENSE"), path.join(directory, "LICENSE"))
  await fs.copyFile(path.join(root, "hamzad/NOTICE"), path.join(directory, "NOTICE"))

  // ripgrep publishes no musl build for arm64, and its glibc build does not start there, so that one
  // target ships without it and fetches nothing: Alpine has ripgrep as a package.
  const [os, arch] = target.split("-")
  const asset = ripgrepAssets.get(`${arch}-${os === "windows" ? "win32" : os}`)
  if (withRipgrep && asset && target !== "linux-arm64-musl") {
    const archive = await ripgrepArchive(asset)
    const unpacked = await fs.mkdtemp(path.join(stage, "rg-"))
    if (asset.extension === "zip") await $`unzip -q -o ${archive} -d ${unpacked}`
    else await $`tar -xzf ${archive} -C ${unpacked}`
    const rg = windows ? "rg.exe" : "rg"
    await fs.copyFile(
      path.join(unpacked, `ripgrep-${ripgrepVersion}-${asset.platform}`, rg),
      path.join(directory, "bin", rg),
    )
    await fs.chmod(path.join(directory, "bin", rg), 0o755)
    await fs.rm(unpacked, { recursive: true, force: true })
  }

  // The same bytes for the same inputs, whoever runs this and when.
  await $`tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 -czf ${path.join(releases, `${name}.tar.gz`)} -C ${stage} ${name}`
  console.log(`packed ${name}.tar.gz`)
}
await fs.rm(stage, { recursive: true, force: true })

const archives = (await fs.readdir(releases)).filter((name) => name.endsWith(".tar.gz")).toSorted()
await Bun.write(
  path.join(releases, "SHA256SUMS"),
  (
    await Promise.all(
      archives.map(async (name) => `${sha256(await Bun.file(path.join(releases, name)).bytes())}  ${name}`),
    )
  ).join("\n") + "\n",
)

// Compact on purpose: the installer reads the version with sed and expects no spaces.
await Bun.write(
  path.join(out, "latest.json"),
  JSON.stringify({ version, metadata: { package: `${Brand.scope}/cli` } }) + "\n",
)
await fs.copyFile(path.join(root, "hamzad/install"), path.join(out, "install"))

if (withRipgrep) for (const asset of ripgrepAssets.values()) await ripgrepArchive(asset)

if (withGrammars) {
  const urls = Array.from(
    new Set(
      parsers.parsers.flatMap((parser) => [
        parser.wasm,
        ...Object.values(parser.queries as Record<string, readonly string[] | undefined>).flatMap((list) => list ?? []),
      ]),
    ),
  )
  // Eight at a time: enough to be quick, few enough not to be refused.
  const pending = [...urls]
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let url = pending.pop(); url; url = pending.pop()) {
        const address = new URL(url)
        const file = path.join(out, "mirror", "ts", address.host, decodeURIComponent(address.pathname))
        await fs.mkdir(path.dirname(file), { recursive: true })
        await Bun.write(file, await download(url))
      }
    }),
  )
  console.log(`mirrored ${urls.length} grammar files`)
}

console.log(`\n${out}\n  ${archives.length} archives for ${version}`)
