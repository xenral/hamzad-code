// The CLI, end to end, against the stand-in gateway: sign in by approving the device, send a prompt
// that needs a tool, and check what came back, what it cost and where the CLI connected.
//
//   bun hamzad/test/e2e.ts                        the CLI from source
//   bun hamzad/test/e2e.ts --bin dist/.../hamzad  a built binary
//   … --rg path/to/rg                             also search with this ripgrep, as an install provides it
//
// Every directory the CLI writes is a temporary one, so a real install is never touched.

import fs from "fs/promises"
import os from "os"
import path from "path"
import { key, panelKey, start } from "./mock-gateway"

const root = path.join(import.meta.dir, "../..")
const flag = process.argv.indexOf("--bin")
const bin = flag === -1 ? undefined : path.resolve(process.argv[flag + 1])
const rgFlag = process.argv.indexOf("--rg")
const rg = rgFlag === -1 ? undefined : path.resolve(process.argv[rgFlag + 1])
const cli = bin ? [bin] : [process.execPath, "run", "--cwd", path.join(root, "packages/cli"), "src/index.ts"]

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : `\n     ${JSON.stringify(detail)}`}`)
  if (!ok) failures.push(name)
}

const home = await fs.mkdtemp(path.join(os.tmpdir(), "hamzad-e2e-"))
const project = path.join(home, "project")
await fs.mkdir(project, { recursive: true })
await fs.mkdir(path.join(home, "tmp"))
await fs.writeFile(path.join(project, "NOTES.txt"), "zanbagh is the first word of this note\n")
// The installer puts ripgrep where only the CLI looks for it; with it there, a search needs no download.
if (rg) {
  const tools = path.join(home, "cache", "hamzad", "bin")
  await fs.mkdir(tools, { recursive: true })
  await fs.copyFile(rg, path.join(tools, path.basename(rg)))
  await fs.chmod(path.join(tools, path.basename(rg)), 0o755)
}

// Anything the CLI sends to a host other than this machine goes through here, is written down, and is refused.
const outside: string[] = []
const proxy = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, data) {
      const line = data.toString("latin1").split("\r\n")[0] ?? ""
      outside.push(line.split(" ").slice(0, 2).join(" "))
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    },
  },
})

const gateway = start({ approveAfter: 1 })
const environment = {
  PATH: process.env.PATH,
  HOME: home,
  TERM: "dumb",
  NO_COLOR: "1",
  TMPDIR: path.join(home, "tmp"),
  XDG_CONFIG_HOME: path.join(home, "config"),
  XDG_DATA_HOME: path.join(home, "data"),
  XDG_CACHE_HOME: path.join(home, "cache"),
  XDG_STATE_HOME: path.join(home, "state"),
  HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
  HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
  HAMZAD_API_URL: gateway.api,
  // A stock OpenCode setup in the environment must not be followed.
  OPENCODE_CONFIG_DIR: path.join(home, "someone-elses-opencode"),
  // From source the CLI runs inside this repository, whose own project config asks for reference
  // repositories from GitHub. A built binary runs in the test's project and needs no such switch.
  ...(bin ? {} : { HAMZAD_DISABLE_PROJECT_CONFIG: "1" }),
  // Windows finds the home and temp directories, and its own system files, through these.
  ...(process.platform === "win32"
    ? {
        USERPROFILE: home,
        TEMP: path.join(home, "tmp"),
        TMP: path.join(home, "tmp"),
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
      }
    : {}),
}

async function run(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn({
    cmd: [...cli, ...args],
    cwd: project,
    env: { ...environment, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 180_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  return { stdout, stderr, code }
}

type Event = {
  type: string
  part?: {
    text?: string
    tool?: string
    cost?: number
    tokens?: { input: number; output: number }
    state?: { status?: string }
  }
  error?: { message?: string }
}
const events = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Event)

try {
  const version = await run(["--version"])
  check("the command answers to its own name", version.code === 0 && /^hamzad /.test(version.stdout.trim()), version)

  // The help a person reads first names this program, not the one it is built on.
  const help = await Promise.all(
    [["--help"], ["auth", "--help"], ["run", "--help"], ["models", "--help"], ["upgrade", "--help"]].map((args) =>
      run(args),
    ),
  )
  check(
    "the top-level help texts say Hamzad and never OpenCode",
    help.every((screen) => screen.code === 0 && !/opencode/i.test(screen.stdout)) &&
      help[0].stdout.includes("Directory to start Hamzad in") &&
      help[0].stdout.includes("Run Hamzad with a message"),
    help.map((screen) => screen.stdout.match(/.*opencode.*/gi)),
  )

  // A first run, before any sign-in: the models and their prices are there to see.
  const listed = await run(["models", "--standalone"])
  check(
    "signed out, the models that need no plan are listed",
    listed.code === 0 &&
      ["hamzad/claude-sonnet", "hamzad/claude-haiku", "hamzad/deepseek"].every((id) => listed.stdout.includes(id)) &&
      !listed.stdout.includes("hamzad/claude-opus"),
    { code: listed.code, stdout: listed.stdout.slice(-400), stderr: listed.stderr.slice(-300) },
  )
  check(
    "signed out, the list was asked for with no credential",
    gateway.requests.some((request) => request.path === "/llm/models" && request.authorization === null),
  )

  const signedOut = await run(["run", "--standalone", "--auto", "--format", "json", "hello"])
  check(
    "signed out, a prompt is answered with how to sign in",
    signedOut.code !== 0 && (signedOut.stdout + signedOut.stderr).includes("hamzad auth login"),
    { code: signedOut.code, output: (signedOut.stdout + signedOut.stderr).slice(-400) },
  )
  // The prompt and its title are each asked for; neither is sent a second time.
  const unsigned = gateway.requests.filter((request) => request.path === "/llm/chat/completions")
  check(
    "signed out, what reached the gateway carried no credential and the prompt was not sent again",
    unsigned.length > 0 &&
      unsigned.every((request) => request.authorization === null) &&
      unsigned.filter((request) => request.body?.tools.length).length === 1,
    unsigned.map((request) => ({ model: request.body?.model, tools: request.body?.tools.length })),
  )

  // No argument and no terminal: `auth login` means Hamzad, by approving the device.
  const login = await run(["auth", "login", "--standalone"])
  check("a bare `auth login` signs in to Hamzad", login.code === 0, {
    code: login.code,
    stderr: login.stderr.slice(-400),
  })
  check(
    "the sign-in shows the code to enter",
    (login.stdout + login.stderr).includes("ABCD-EFGH"),
    (login.stdout + login.stderr).slice(-400),
  )
  check(
    "the gateway was asked for a code and polled until approved",
    gateway.requests.filter((request) => request.path === "/auth/device/token").length === 2,
  )

  const accounts = await run(["auth", "list", "--standalone"])
  check(
    "the sign-in is listed under the account the gateway named",
    (accounts.stdout + accounts.stderr).includes("+98912•••0001"),
    (accounts.stdout + accounts.stderr).slice(-400),
  )
  const all = await run(["models", "--standalone"])
  check(
    "signed in, the list also holds the models that need a plan",
    all.stdout.includes("hamzad/claude-opus") && all.stdout.includes("hamzad/claude-sonnet"),
    all.stdout.slice(-400),
  )

  const prompt = `Read NOTES.txt and say what it holds. [[tool:read ${JSON.stringify({ path: path.join(project, "NOTES.txt") })}]]`
  const asked = await run(["run", "--standalone", "--auto", "--format", "json", prompt])
  const stream = events(asked.stdout)
  check("the prompt finishes", asked.code === 0, { code: asked.code, stderr: asked.stderr.slice(-600) })
  check(
    "the model's tool call ran",
    stream.some(
      (event) => event.type === "tool_use" && event.part?.tool === "read" && event.part.state?.status === "completed",
    ),
  )
  check(
    "the reply quotes what the tool read",
    stream.some((event) => event.type === "text" && event.part?.text?.includes("zanbagh")),
  )
  const steps = stream.filter((event) => event.type === "step_finish")
  check(
    "every step reports tokens and a cost in credits",
    steps.length === 2 && steps.every((step) => (step.part?.cost ?? 0) > 0 && (step.part?.tokens?.input ?? 0) > 0),
    steps.map((step) => step.part),
  )

  // The one request sent before signing in is not part of what follows.
  const chats = gateway.requests.filter(
    (request) => request.path === "/llm/chat/completions" && request.authorization !== null,
  )
  const turns = chats.filter((request) => request.body?.tools.includes("read"))
  check(
    "the gateway got the key the device was given",
    chats.length > 0 && chats.every((request) => request.authorization === `Bearer ${key}`),
  )
  check(
    "the gateway was asked to report credits",
    chats.every((request) => request.unit === "credit"),
  )
  check(
    "usage was asked for in the stream",
    chats.every((request) => request.body?.stream === true && request.body.usage === true),
  )
  check(
    "the tool's result went back to the model",
    turns.length === 2 && turns[1]?.body?.roles.at(-1) === "tool",
    turns.map((turn) => turn.body?.roles),
  )
  check(
    "requests name this build",
    chats.every((request) => request.agent?.startsWith("hamzad/") ?? false),
    chats[0]?.agent,
  )
  check(
    "the model is told it runs in Hamzad CLI, not in OpenCode",
    turns.length > 0 &&
      turns.every(
        (turn) => (turn.body?.opening.includes("Hamzad CLI") ?? false) && !/opencode/i.test(turn.body?.opening ?? ""),
      ),
    turns.map((turn) => turn.body?.opening),
  )
  check(
    "the prompt went to the gateway's default model",
    turns.length > 0 && turns.every((turn) => turn.body?.model === "claude-sonnet"),
    turns.map((turn) => turn.body?.model),
  )
  check(
    "the title went to the small model",
    chats.some((request) => request.body?.model === "claude-haiku" && request.body.tools.length === 0),
    chats.map((request) => request.body?.model),
  )
  const spent = steps.reduce((sum, step) => sum + (step.part?.cost ?? 0), 0)
  check(
    "the credits shown are the credits the gateway charged for those steps",
    spent > 0 && spent <= gateway.state.spent + 1e-9,
    { spent, charged: gateway.state.spent },
  )

  if (rg) {
    const search = await run([
      "run",
      "--standalone",
      "--auto",
      "--format",
      "json",
      `Find the note. [[tool:grep ${JSON.stringify({ pattern: "zanbagh", path: project })}]]`,
    ])
    check(
      "a search runs with the ripgrep an install provides",
      events(search.stdout).some(
        (event) => event.type === "tool_use" && event.part?.tool === "grep" && event.part.state?.status === "completed",
      ) && events(search.stdout).some((event) => event.type === "text" && event.part?.text?.includes("NOTES.txt")),
      { code: search.code, stderr: search.stderr.slice(-400) },
    )
  }

  const refused = await run([
    "run",
    "--standalone",
    "--auto",
    "--format",
    "json",
    "[[refuse:insufficient_quota]] hello",
  ])
  check(
    "a refusal for credits says where to top up",
    (refused.stdout + refused.stderr).includes("https://hamzad.ai/panel/billing"),
    (refused.stdout + refused.stderr).slice(-500),
  )

  const before = gateway.requests.length
  const capped = await run(["run", "--standalone", "--auto", "--format", "json", "[[refuse:daily_spend_limit]] hello"])
  check(
    "the day's limit is final: said once, in the gateway's words, and not tried again",
    capped.code !== 0 &&
      (capped.stdout + capped.stderr).includes("Today's usage limit of 800 credits is reached") &&
      gateway.requests.slice(before).filter((request) => request.body?.tools.length).length === 1,
    {
      code: capped.code,
      requests: gateway.requests.slice(before).map((request) => request.path),
      output: (capped.stdout + capped.stderr).slice(-400),
    },
  )

  // A key in the environment is the one meant, even with a sign-in stored.
  const mark = gateway.requests.length
  const override = await run(["run", "--standalone", "--auto", "--format", "json", "hello"], {
    HAMZAD_API_KEY: panelKey,
  })
  const overridden = gateway.requests.slice(mark).filter((request) => request.path === "/llm/chat/completions")
  check(
    "HAMZAD_API_KEY is used ahead of the stored sign-in",
    override.code === 0 &&
      overridden.length > 0 &&
      overridden.every((request) => request.authorization === `Bearer ${panelKey}`),
    { code: override.code, sent: overridden.map((request) => request.authorization?.slice(0, 18)) },
  )
  const both = await run(["auth", "list", "--standalone"], { HAMZAD_API_KEY: panelKey })
  check(
    "`auth list` says the environment's key is the one in use",
    /HAMZAD_API_KEY\s+environment, in use/.test(both.stdout) && /\+98912•••0001\s+stored\s*$/m.test(both.stdout),
    both.stdout,
  )

  const logout = await run(["auth", "logout", "--standalone"])
  const after = await run(["auth", "list", "--standalone"])
  check(
    "a bare `auth logout` removes the one Hamzad sign-in",
    logout.code === 0 && !after.stdout.includes("+98912•••0001"),
    { code: logout.code, output: (logout.stdout + logout.stderr).slice(-300), list: after.stdout },
  )

  const withKey = await run(["run", "--standalone", "--auto", "--format", "json", "hello"], {
    XDG_DATA_HOME: path.join(home, "data-2"),
    XDG_STATE_HOME: path.join(home, "state-2"),
    HAMZAD_API_KEY: key,
  })
  check(
    "HAMZAD_API_KEY alone is enough on a fresh machine",
    withKey.code === 0 && events(withKey.stdout).some((event) => event.type === "text"),
    { code: withKey.code, stderr: withKey.stderr.slice(-400) },
  )

  // The states production starts in: open to some accounts only, switched off, open to staff only.
  // `second` is the machine above, which has a key and a saved model list; `fresh` has neither.
  const second = {
    XDG_DATA_HOME: path.join(home, "data-2"),
    XDG_STATE_HOME: path.join(home, "state-2"),
    HAMZAD_API_KEY: key,
  }
  const fresh = (name: string) => ({
    XDG_DATA_HOME: path.join(home, `data-${name}`),
    XDG_STATE_HOME: path.join(home, `state-${name}`),
  })
  const hello = ["run", "--standalone", "--auto", "--format", "json", "hello"]
  const prompts = (since: number) =>
    gateway.requests.slice(since).filter((request) => request.body?.tools.length).length
  const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr
  const raw = /status ?code|non 2xx|https?:\/\/127\.0\.0\.1/i

  gateway.state.denied = true
  const beforeDenied = gateway.requests.length
  const denied = await run(hello, second)
  check(
    "an account the gateway is not open to yet is told so, once",
    denied.code !== 0 &&
      output(denied).includes("This account does not have access to the API yet.") &&
      prompts(beforeDenied) === 1,
    { code: denied.code, prompts: prompts(beforeDenied), output: output(denied).slice(-300) },
  )
  gateway.state.denied = false

  gateway.state.stage = "off"
  const beforeOff = gateway.requests.length
  const off = await run(hello, second)
  check(
    "with the gateway switched off, a prompt says it is not available yet, once",
    off.code !== 0 &&
      output(off).includes("Hamzad's API for tools is not available yet.") &&
      !output(off).includes("Not found.") &&
      prompts(beforeOff) === 1,
    { code: off.code, prompts: prompts(beforeOff), output: output(off).slice(-300) },
  )
  const offModels = await run(["models", "--standalone"], fresh("off"))
  check(
    "switched off, an empty model list says why",
    !offModels.stdout.includes("hamzad/") && offModels.stderr.includes("Hamzad's API for tools is not available yet."),
    { stdout: offModels.stdout.slice(-200), stderr: offModels.stderr.slice(-300) },
  )
  const offLogin = await run(["auth", "login", "--standalone"], fresh("off"))
  check(
    "switched off, a sign-in says the same in words, not a status line",
    offLogin.code !== 0 &&
      output(offLogin).includes("Hamzad's API for tools is not available yet.") &&
      !raw.test(output(offLogin)),
    { code: offLogin.code, output: output(offLogin).slice(-300) },
  )

  gateway.state.stage = "staff"
  const staffModels = await run(["models", "--standalone"], fresh("staff"))
  check(
    "open to staff only, a signed-out model list says to sign in",
    !staffModels.stdout.includes("hamzad/") &&
      staffModels.stderr.includes("Sign in to see Hamzad's models: run `hamzad auth login`."),
    { stdout: staffModels.stdout.slice(-200), stderr: staffModels.stderr.slice(-300) },
  )
  gateway.state.stage = "everyone"

  gateway.state.attempts = true
  const tooMany = await run(["auth", "login", "--standalone"], fresh("attempts"))
  check(
    "too many sign-ins started is said in words",
    tooMany.code !== 0 &&
      output(tooMany).includes("Too many sign-in attempts. Try again in a little while.") &&
      !raw.test(output(tooMany)),
    { code: tooMany.code, output: output(tooMany).slice(-300) },
  )
  gateway.state.attempts = false

  check("files went to Hamzad's own directories", await exists(path.join(home, "data", "hamzad")))
  check(
    "nothing was written under an opencode directory",
    !(await exists(path.join(home, "data", "opencode"))) &&
      !(await exists(path.join(home, "config", "opencode"))) &&
      !(await exists(path.join(home, "someone-elses-opencode"))),
  )
  check("the CLI contacted no host but this machine", outside.length === 0, outside)
} finally {
  await gateway.server.stop(true)
  proxy.stop(true)
  await fs.rm(home, { recursive: true, force: true }).catch(() => {})
}

async function exists(target: string) {
  return fs.access(target).then(
    () => true,
    () => false,
  )
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
