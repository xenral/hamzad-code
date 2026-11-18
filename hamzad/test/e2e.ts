// The CLI, end to end, against the stand-in gateway: sign in by approving the device, send a prompt
// that needs a tool, and check what came back, what it cost and where the CLI connected.
//
//   bun hamzad/test/e2e.ts                      the CLI from source
//   bun hamzad/test/e2e.ts --bin dist/.../hamzad  a built binary
//
// Every directory the CLI writes is a temporary one, so a real install is never touched.

import fs from "fs/promises"
import os from "os"
import path from "path"
import { key, start } from "./mock-gateway"

const root = path.join(import.meta.dir, "../..")
const flag = process.argv.indexOf("--bin")
const bin = flag === -1 ? undefined : path.resolve(process.argv[flag + 1])
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

  // Signed out, a prompt has no model to go to.
  const signedOut = await run(["run", "--standalone", "--auto", "--format", "json", "hello"])
  check("signed out, nothing is sent to the gateway's chat route", signedOut.code !== 0, {
    code: signedOut.code,
    stderr: signedOut.stderr.slice(-300),
  })
  check(
    "signed out, no chat request reached the gateway",
    !gateway.requests.some((request) => request.path === "/llm/chat/completions"),
  )

  const login = await run(["auth", "login", "hamzad", "--method", "device", "--standalone"])
  check("the device sign-in completes", login.code === 0, { code: login.code, stderr: login.stderr.slice(-400) })
  check(
    "the sign-in shows the code to enter",
    (login.stdout + login.stderr).includes("ABCD-EFGH"),
    (login.stdout + login.stderr).slice(-400),
  )
  check(
    "the gateway was asked for a code and polled until approved",
    gateway.requests.filter((request) => request.path === "/auth/device/token").length === 2,
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

  const chats = gateway.requests.filter((request) => request.path === "/llm/chat/completions")
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
    "the title went to the small model",
    chats.some((request) => request.body?.model === "deepseek" && request.body.tools.length === 0),
    chats.map((request) => request.body?.model),
  )
  const spent = steps.reduce((sum, step) => sum + (step.part?.cost ?? 0), 0)
  check(
    "the credits shown are the credits the gateway charged for those steps",
    spent > 0 && spent <= gateway.state.spent + 1e-9,
    { spent, charged: gateway.state.spent },
  )

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
