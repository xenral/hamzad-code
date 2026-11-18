# Hamzad CLI

A coding agent for the terminal, on your Hamzad account. You sign in once by approving the device
in your panel, and what you use is paid from your Hamzad credits, per token.

```bash
curl -fsSL https://hamzad.ai/cli/install | bash
hamzad auth login
cd <project> && hamzad
```

The guide, in Persian, is at <https://hamzad.ai/cli>.

## Built on OpenCode

Hamzad CLI is built on [OpenCode](https://github.com/anomalyco/opencode), MIT License, Copyright (c)
2025 opencode. Hamzad CLI is not built by the OpenCode team and is not affiliated with them in any
way. Please report problems to Hamzad, not to the OpenCode project.

Project files stay compatible: `opencode.json`, `.opencode/` and `AGENTS.md` in a repository are read
as OpenCode reads them. Hamzad's own files live apart from a stock OpenCode install (`~/.config/hamzad`,
`~/.local/share/hamzad`, `~/.hamzad`), so both run side by side.

## What differs from upstream

Everything that tells this build apart is in a few places, so that upstream can be merged often:

| Where                                        | What                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/util/src/brand.ts`, `brand-env.ts` | Names, directories, ports, addresses, how money is written; `HAMZAD_*` variables read as `OPENCODE_*`              |
| `packages/core/src/hamzad/`                  | Hamzad as a provider: sign-in, the model list (shown before sign-in too), the balance, what a refused sign-in says |
| `packages/tui/src/hamzad/`                   | The credits left, in the sidebar and under the prompt; the sign-in dialog when a prompt is sent before signing in  |
| `hamzad/`                                    | The installer, the packing script, the stand-in gateway and the end-to-end check                                   |
| `.github/workflows/hamzad-*.yml`             | The release                                                                                                        |

Upstream's own files are edited only to read a value from the brand module or to call into one of the
folders above. `git diff <upstream commit> -- . ':!hamzad' ':!packages/*/src/hamzad' ':!packages/*/test/hamzad'`
shows all of it.

## Working on it

```bash
bun install
bun run dev                                    # the CLI from source
bun hamzad/test/mock-gateway.ts                # a stand-in for Hamzad's API on :8787
HAMZAD_API_URL=http://127.0.0.1:8787/api/v1 bun run dev
bun hamzad/test/e2e.ts                         # sign in, prompt, tool call, credits, no outside host
```

Upstream's tests assert upstream's names, so they run with `HAMZAD_BRAND=upstream`; the tests under
`packages/*/test/hamzad` run without it.

| Variable                                  | Meaning                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `HAMZAD_API_KEY`                          | A key from the panel, instead of signing in                        |
| `HAMZAD_API_URL`                          | Another API address, e.g. a local core                             |
| `HAMZAD_UPSTREAM_PROVIDERS=1`             | Bring back upstream's hosted providers and other vendors' sign-ins |
| `HAMZAD_MODELS_URL`, `HAMZAD_MODELS_PATH` | A catalog of other providers' models to load                       |
| `HAMZAD_<NAME>`                           | Any upstream `OPENCODE_<NAME>` setting                             |

### Taking a new upstream version

Merge the commit an upstream release tag was cut from (the tag itself is one commit off `dev` that
only bumps versions), never a rebase:

```bash
git fetch upstream dev && git fetch upstream tag v2.3.N --no-tags
git merge v2.3.N^
```

Then run the checks above, both test profiles, and the end-to-end check, which fails when a merge
brings in a new outside host.
