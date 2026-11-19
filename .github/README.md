# Hamzad CLI

A coding agent for the terminal, on your Hamzad account. You sign in once by approving the device
in your panel, and what you use is paid from your Hamzad credits, per token.

```bash
curl -fsSL https://hamzad.ai/cli/install | bash
hamzad auth login
cd <project> && hamzad
```

That is Linux, macOS, and Windows in Git Bash. The installer takes the archive for your machine from
the newest [release](https://github.com/xenral/hamzad-code/releases) and checks it against the
release's `SHA256SUMS` before unpacking it into `~/.hamzad/bin`. The same installer straight from
this repository: `curl -fsSL https://github.com/xenral/hamzad-code/releases/latest/download/install | bash`.

The guide, in Persian, is at <https://hamzad.ai/cli>.

Signing in needs Hamzad's API for tools to be open for your account. Until it is, the CLI says that
it is not available yet.

## Built on OpenCode

Hamzad CLI is built on [OpenCode](https://github.com/anomalyco/opencode), MIT License, Copyright (c)
2025 opencode. Hamzad CLI is not built by the OpenCode team and is not affiliated with them in any
way. Please report problems to Hamzad, not to the OpenCode project.

Project files stay compatible: `opencode.json`, `.opencode/` and `AGENTS.md` in a repository are read
as OpenCode reads them. The settings file may also be named `hamzad.json` or `hamzad.jsonc`, which is
the name a new one is written under; where both are there, Hamzad's is read last. Hamzad's own files
live apart from a stock OpenCode install (`~/.config/hamzad`, `~/.local/share/hamzad`, `~/.hamzad`), so
both run side by side.

A new version installs itself when one is out. `"update": "notify"` in the settings file only says so,
`"update": "disable"` or `HAMZAD_DISABLE_AUTOUPDATE=1` stops the looking.

## What differs from upstream

Everything that tells this build apart is in a few places, so that upstream can be merged often:

| Where                                        | What                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/util/src/brand.ts`, `brand-env.ts` | Names, directories, ports, addresses, how money is written; `HAMZAD_*` variables read as `OPENCODE_*`                                                                         |
| `packages/util/src/hamzad-status.ts`         | The states Hamzad's API can be in (not open yet, sign-in wanted, no access, out of reach) and the sentence for each, shared by the server, the command line and the interface |
| `packages/core/src/hamzad/`                  | Hamzad as a provider: sign-in, the model list (shown before sign-in too), the balance, what a refused sign-in says                                                            |
| `packages/tui/src/hamzad/`                   | The credits left, in the sidebar and under the prompt; `/usage`; the sign-in dialog when a prompt is sent before signing in                                                   |
| `packages/cli/src/hamzad/`                   | `auth login` and `auth logout` meaning Hamzad when nothing is named; `auth list` marking the sign-in in use                                                                   |
| `hamzad/script/brand-transform.ts`           | The product's name in every sentence a person reads, rewritten as the sources are loaded: in the build, and from source through `brand-preload.ts`                            |
| `hamzad/script/check-brand.ts`               | The check that a built binary names upstream nowhere a person reads it                                                                                                        |
| `hamzad/`                                    | The installer, the packing script, the stand-in gateway and the end-to-end check                                                                                              |
| `.github/workflows/hamzad-*.yml`             | The checks, the release, and the weekly try at merging upstream                                                                                                               |
| `.github/upstream-workflows/`                | Upstream's own workflows, parked where GitHub does not run them                                                                                                               |

Upstream's own files are edited only to read a value from the brand module or to call into one of the
folders above. `git diff <upstream commit> -- . ':!hamzad' ':!packages/*/src/hamzad' ':!packages/*/test/hamzad'`
shows all of it.

Upstream's sentences are not edited at all. It names itself in several hundred of them, across some
140 files, and the transform rewrites that name where it is text (a string, a template, the words of
a component, a prompt file) and leaves it where another program reads it: identifiers, package and
plugin ids, headers, paths, hosts, and the names of upstream's own hosted services, which this build
does not offer. `HAMZAD_BRAND=upstream` switches it off.

## Working on it

```bash
bun install
bun run dev                                    # the CLI from source
bun hamzad/test/mock-gateway.ts                # a stand-in for Hamzad's API on :8787
HAMZAD_API_URL=http://127.0.0.1:8787/api/v1 bun run dev
bun hamzad/test/e2e.ts                         # sign in, prompt, tool call, credits, no outside host
bun hamzad/test/e2e.ts --bin <binary>          # the same for a built binary, with updating and the name check
bun hamzad/script/check-brand.ts <binary>      # where a binary still holds upstream's name, by kind
```

Upstream's tests assert upstream's names, so they run with `HAMZAD_BRAND=upstream`; the tests under
`packages/*/test/hamzad` run without it.

| Variable                                  | Meaning                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `HAMZAD_API_KEY`                          | A key from the panel, instead of signing in; used ahead of a stored sign-in whenever it is set |
| `HAMZAD_API_URL`                          | Another API address, e.g. a local core                                                         |
| `HAMZAD_UPSTREAM_PROVIDERS=1`             | Bring back upstream's hosted providers and other vendors' sign-ins                             |
| `HAMZAD_MODELS_URL`, `HAMZAD_MODELS_PATH` | A catalog of other providers' models to load                                                   |
| `HAMZAD_<NAME>`                           | Any upstream `OPENCODE_<NAME>` setting                                                         |

### Taking a new upstream version

Merge the commit an upstream release tag was cut from (the tag itself is one commit off `dev` that
only bumps versions), never a rebase:

```bash
git fetch upstream dev && git fetch upstream tag v2.3.N --no-tags
git merge v2.3.N^
```

Then run the checks above, both test profiles, and the end-to-end check, which fails when a merge
brings in a new outside host, a command whose help names upstream, or a sentence in the binary that
the transform's rules do not reach. `check-brand.ts --show <kind>` lists what it counted under a kind;
a new sentence is fixed by a rule in `brand-transform.ts`, never by editing upstream's file. A workflow
upstream added arrives in `.github/workflows/`: move it to `.github/upstream-workflows/` in the merge
commit, or the check fails.

### Releasing

A version is the upstream version it is built on, then `-hamzad.<n>`. Pushing the tag
`hamzad-v<version>` builds every platform, installs and runs each build on its own platform, and
publishes a GitHub Release with the archives, their checksums and the installer:

```bash
git tag hamzad-v2.3.2-hamzad.1 && git push origin hamzad-v2.3.2-hamzad.1
```

To rehearse it first, push the same commit as a branch `hamzad-try/<version>`: everything runs but
the release. Delete the branch afterwards.
