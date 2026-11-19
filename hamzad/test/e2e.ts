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
import { Brand } from "../../packages/util/src/brand"
import { HamzadRtl } from "../../packages/util/src/hamzad-rtl"
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
  // On a runner, the failed check is also left where it shows without opening the log.
  if (!ok && process.env.GITHUB_ACTIONS === "true") {
    const told = detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`
    console.log(`::error title=end to end::${told.slice(0, 1800).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`)
  }
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

// Every command's help, found by following the subcommands each screen lists. A few at a time:
// from source each one is a whole start of the program.
const turns = { free: 4, waiting: [] as (() => void)[] }
async function limited<A>(work: () => Promise<A>) {
  if (turns.free === 0) await new Promise<void>((resolve) => turns.waiting.push(resolve))
  else turns.free--
  return work().finally(() => {
    const next = turns.waiting.shift()
    if (next) next()
    else turns.free++
  })
}
async function helps(command: string[] = []): Promise<{ command: string; code: number; stdout: string }[]> {
  const screen = await limited(() => run([...command, "--help"]))
  const listed = /^SUBCOMMANDS\r?\n((?: .*\r?\n?)*)/m.exec(screen.stdout)?.[1] ?? ""
  const below = await Promise.all(
    [...listed.matchAll(/^ {2}([a-z][\w-]*)/gm)].map((match) => helps([...command, match[1]])),
  )
  return [{ command: command.join(" "), code: screen.code, stdout: screen.stdout }, ...below.flat()]
}

// The interface in a pseudo-terminal: what it has written so far with the escape sequences taken
// out, the titles it gave the window, and a way to type into it.
const escapes = /\x1b\[[0-9;?<>=]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g
async function interactive(
  env: Record<string, string>,
  drive: (screen: {
    text: () => string
    titles: () => string[]
    type: (keys: string) => void
    /** Has the whole screen drawn again, and gives where in `text()` that drawing begins. */
    redraw: () => number
    until: (seen: () => boolean, milliseconds?: number) => Promise<boolean>
  }) => Promise<void>,
  args: string[] = ["--standalone"],
) {
  const written = { raw: "" }
  const decoder = new TextDecoder()
  const child = Bun.spawn({
    cmd: [...cli, ...args],
    cwd: project,
    env: { ...environment, TERM: "xterm-256color", NO_COLOR: undefined, ...env },
    terminal: {
      cols: 140,
      rows: 45,
      data: (_terminal: unknown, data: Uint8Array) => void (written.raw += decoder.decode(data, { stream: true })),
    },
  } as never) as unknown as {
    terminal: { write: (keys: string) => void; resize: (cols: number, rows: number) => void }
    kill: () => void
    exited: Promise<number>
  }
  const text = () => written.raw.replace(escapes, "")
  // A terminal is sent only the cells that change, so a number whose middle digit stays the same
  // arrives in pieces and cannot be read back from what was written. A change of width has the
  // interface draw every line whole again; what is written after it can be read as it looks.
  const size = { cols: 140 }
  try {
    await drive({
      text,
      titles: () => [...written.raw.matchAll(/\x1b\][02];([^\x07\x1b]*)/g)].map((match) => match[1]),
      type: (keys) => child.terminal.write(keys),
      redraw: () => {
        const from = text().length
        size.cols = size.cols === 140 ? 141 : 140
        child.terminal.resize(size.cols, 45)
        return from
      },
      until: async (seen, milliseconds = 60_000) => {
        const end = Date.now() + milliseconds
        while (Date.now() < end) {
          if (seen()) return true
          await Bun.sleep(200)
        }
        return seen()
      },
    })
  } finally {
    child.kill()
    await child.exited
  }
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

  // The help of every command names this program, not the one it is built on.
  const help = await helps()
  check(
    "every command's help says Hamzad and never OpenCode",
    help.length > 40 &&
      help.every((screen) => screen.code === 0 && !/opencode/i.test(screen.stdout)) &&
      help[0].stdout.includes("Directory to start Hamzad in") &&
      help[0].stdout.includes("Run Hamzad with a message") &&
      help.some((screen) => screen.command === "upgrade" && screen.stdout.includes("Upgrade Hamzad")),
    {
      commands: help.length,
      failed: help.filter((screen) => screen.code !== 0).map((screen) => screen.command),
      named: help.flatMap((screen) => screen.stdout.match(/.*opencode.*/gi) ?? []).slice(0, 12),
    },
  )
  const completions = await Promise.all(["bash", "zsh", "fish"].map((shell) => run(["--completions", shell])))
  check(
    "the shell completions name only this command",
    completions.every(
      (script) => script.code === 0 && script.stdout.includes("hamzad") && !/opencode/i.test(script.stdout),
    ),
    completions.map((script) => script.stdout.match(/.*opencode.*/gi)?.slice(0, 3)),
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

  // The interface itself: the credits left move when a prompt is answered, and `/usage` is Hamzad's.
  // A pseudo-terminal is needed, which Windows does not give a child process this way.
  if (process.platform !== "win32") {
    const left = (text: string) => [...text.matchAll(/([\d,]+\.\d\d) cr left/g)].at(-1)?.[1]
    const amount = (figure: string | undefined) =>
      figure === undefined ? Number.NaN : Number(figure.replace(/,/g, ""))
    // No look for a new version here: that would be a call to Hamzad's own site, checked further down.
    await interactive({ HAMZAD_DISABLE_AUTOUPDATE: "1" }, async (screen) => {
      // The figure as the screen shows it now, read from a fresh drawing of the whole screen.
      const figure = async () => {
        const from = screen.redraw()
        await screen.until(() => left(screen.text().slice(from)) !== undefined, 15_000)
        return left(screen.text().slice(from))
      }
      const shown = await screen.until(() => left(screen.text()) !== undefined)
      const before = await figure()
      // The home screen in Hamzad's words: the line under the wordmark, the prompt, the mode.
      const drawn = screen.redraw()
      const own = ["your coding twin", "Tell Hamzad what to do", "Code · ", "shift+tab mode"]
      check(
        "the home screen speaks as Hamzad: its line, its prompt, Code as the mode",
        await screen.until(() => own.every((word) => screen.text().slice(drawn).includes(word)), 15_000),
        { missing: own.filter((word) => !screen.text().slice(drawn).includes(word)) },
      )
      check(
        "the interface shows the credits left to the hundredth",
        shown && before !== undefined,
        screen.text().slice(-600),
      )
      const charged = gateway.state.spent
      screen.type("Say hello.")
      await Bun.sleep(500)
      screen.type("\r")
      await screen.until(() => gateway.state.spent > charged)
      // The figure follows the answer by one question to the gateway: looked at until it has moved.
      const settled = { after: before }
      for (let attempt = 0; attempt < 30 && !(amount(settled.after) < amount(before)); attempt++) {
        await Bun.sleep(1000)
        settled.after = await figure()
      }
      const after = settled.after
      console.log(`     credits left before a prompt: ${before}, after it: ${after}`)
      check(
        "the credits left go down when a prompt is answered, by what the gateway charged",
        Math.abs(amount(before) - amount(after) - (gateway.state.spent - charged)) < 0.011,
        { before, after, charged: gateway.state.spent - charged },
      )

      check(
        "an answer is signed with the mode that gave it",
        await screen.until(() => screen.text().includes("Code · Claude Sonnet"), 15_000),
        screen.text().slice(-400),
      )

      const asked = gateway.requests.filter((request) => request.path === "/llm/usage/summary").length
      const start = screen.text().length
      screen.type("/usage")
      await Bun.sleep(500)
      screen.type("\r")
      const opened = await screen.until(() => screen.text().slice(start).includes("Add credits:"), 30_000)
      const dialog = screen.text().slice(start)
      check(
        "`/usage` shows the credits left, today, the last 30 days, each model, and where to add credits",
        opened &&
          [
            "cr left",
            "Today",
            "Last 30 days",
            "Requests",
            "Tokens in",
            "Claude Sonnet",
            Brand.billing,
            Brand.settings,
          ].every((word) => dialog.includes(word)) &&
          !/console|workspace|\/connect/i.test(dialog),
        dialog.slice(-900),
      )
      check(
        "opening `/usage` asks the gateway anew",
        gateway.requests.filter((request) => request.path === "/llm/usage/summary").length > asked,
      )
      check(
        "the interface and the window's title never say OpenCode",
        !/opencode/i.test(screen.text()) && screen.titles().every((title) => !/opencode/i.test(title)),
        {
          text: screen
            .text()
            .match(/.{0,40}opencode.{0,40}/gi)
            ?.slice(0, 5),
          titles: [...new Set(screen.titles())],
        },
      )
      console.log(`     window titles: ${JSON.stringify([...new Set(screen.titles())])}`)
    })
  }

  // Persian in VS Code's terminal, which draws text in the order it was written: the interface and a
  // run printing to a terminal lay it out right to left with its letters joined. HAMZAD_RTL=off leaves
  // it as written.
  if (process.platform !== "win32") {
    const sentence = "همزاد کنار کدت می‌نشیند"
    const prompt = `[[tool:bash {"command":"echo ${sentence}","description":"Persian"}]]`
    const seen = HamzadRtl.text(sentence)
    const persian = (text: string) =>
      text.split("\n").filter((line) => [...line].some((char) => char.codePointAt(0)! >= 0x600))
    for (const off of [false, true]) {
      await interactive(
        { HAMZAD_DISABLE_AUTOUPDATE: "1", TERM_PROGRAM: "vscode", ...(off ? { HAMZAD_RTL: "off" } : {}) },
        async (screen) => {
          await screen.until(() => screen.text().includes("Tell Hamzad what to do"))
          const start = screen.text().length
          screen.type(prompt)
          await Bun.sleep(500)
          screen.type("\r")
          await screen.until(() => screen.text().slice(start).includes("The tool returned"), 90_000)
          await Bun.sleep(1000)
          const [wanted, unwanted] = off ? [sentence, seen] : [seen, sentence]
          const from = screen.redraw()
          const shown = await screen.until(() => screen.text().slice(from).includes(wanted), 15_000)
          const drawn = screen.text().slice(from)
          check(
            off
              ? "with HAMZAD_RTL=off, Persian is shown as it was written"
              : "in VS Code's terminal, Persian is shown right to left with its letters joined",
            shown && !drawn.includes(unwanted),
            persian(drawn).slice(0, 6),
          )
        },
      )
    }
    await interactive(
      { HAMZAD_DISABLE_AUTOUPDATE: "1", TERM_PROGRAM: "vscode" },
      async (screen) => {
        const done = await screen.until(() => screen.text().includes("The tool returned"), 90_000)
        check(
          "a run printing to VS Code's terminal writes Persian right to left with its letters joined",
          done && screen.text().includes(seen) && !screen.text().includes(sentence),
          persian(screen.text()).slice(0, 6),
        )
      },
      ["run", "--standalone", "--auto", prompt],
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

  const beforeGone = gateway.requests.length
  const gone = await run(["run", "--standalone", "--auto", "--format", "json", "[[refuse:model_unavailable]] hello"])
  check(
    "a model its provider will not serve is said once, and not asked for again",
    gone.code !== 0 &&
      (gone.stdout + gone.stderr).includes("This model is not available right now. Choose another model.") &&
      gateway.requests.slice(beforeGone).filter((request) => request.body?.tools.length).length === 1,
    {
      code: gone.code,
      requests: gateway.requests.slice(beforeGone).map((request) => request.path),
      output: (gone.stdout + gone.stderr).slice(-400),
    },
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
  const plain = await run(["run", "--standalone", "--auto", "hello"], {
    XDG_DATA_HOME: path.join(home, "data-2"),
    XDG_STATE_HOME: path.join(home, "state-2"),
    HAMZAD_API_KEY: key,
  })
  check(
    "the run's own output names the mode as Code",
    plain.code === 0 && (plain.stdout + plain.stderr).includes("> code · "),
    (plain.stdout + plain.stderr).slice(-300),
  )
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
  const beforeOffRun = gateway.requests.length
  const offRun = await run(hello, fresh("off"))
  check(
    "switched off, a prompt on a new machine says why instead of naming a session with no model",
    offRun.code !== 0 &&
      output(offRun).includes("Hamzad's API for tools is not available yet.") &&
      !output(offRun).includes("No model is available") &&
      gateway.requests.slice(beforeOffRun).every((request) => request.path !== "/llm/chat/completions"),
    { code: offRun.code, output: output(offRun).slice(-300) },
  )
  const offLogin = await run(["auth", "login", "--standalone"], fresh("off"))
  check(
    "switched off, a sign-in says the same in words, not a status line",
    offLogin.code !== 0 &&
      output(offLogin).includes("Hamzad's API for tools is not available yet.") &&
      output(offLogin).includes("Sign in to Hamzad") &&
      output(offLogin).includes("Sign-in failed") &&
      !raw.test(output(offLogin)),
    { code: offLogin.code, output: output(offLogin).slice(-300) },
  )

  // What a copy downloaded today meets: an API that has none of these routes yet.
  gateway.state.stage = "absent"
  const absentModels = await run(["models", "--standalone"], fresh("absent"))
  check(
    "before the API has these routes, an empty model list says it is not available yet",
    !absentModels.stdout.includes("hamzad/") &&
      absentModels.stderr.includes("Hamzad's API for tools is not available yet."),
    { stdout: absentModels.stdout.slice(-200), stderr: absentModels.stderr.slice(-300) },
  )
  const absentLogin = await run(["auth", "login", "--standalone"], fresh("absent"))
  check(
    "before the API has these routes, a sign-in says the same, not to try again later",
    absentLogin.code !== 0 &&
      output(absentLogin).includes("Hamzad's API for tools is not available yet.") &&
      !output(absentLogin).includes("Try again") &&
      !raw.test(output(absentLogin)),
    { code: absentLogin.code, output: output(absentLogin).slice(-300) },
  )
  const absentRun = await run(hello, fresh("absent"))
  check(
    "before the API has these routes, a prompt says the same",
    absentRun.code !== 0 && output(absentRun).includes("Hamzad's API for tools is not available yet."),
    { code: absentRun.code, output: output(absentRun).slice(-300) },
  )

  gateway.state.stage = "staff"
  const staffModels = await run(["models", "--standalone"], fresh("staff"))
  check(
    "open to staff only, a signed-out model list says to sign in",
    !staffModels.stdout.includes("hamzad/") &&
      staffModels.stderr.includes("Sign in to see Hamzad's models: run `hamzad auth login`."),
    { stdout: staffModels.stdout.slice(-200), stderr: staffModels.stderr.slice(-300) },
  )
  if (process.platform !== "win32") {
    await interactive({ ...fresh("staff"), HAMZAD_DISABLE_AUTOUPDATE: "1" }, async (screen) => {
      const named = await screen.until(() => screen.text().includes("Not signed in"), 30_000)
      check(
        "open to staff only and signed out, the prompt says it is not signed in, not to connect a provider",
        named &&
          screen.text().includes("hamzad auth login") &&
          !/No provider selected|Connect a provider/.test(screen.text()),
        screen.text().slice(-600),
      )
    })
  }
  const staffRun = await run(hello, fresh("staff"))
  check(
    "open to staff only, a signed-out prompt says how to sign in",
    staffRun.code !== 0 &&
      output(staffRun).includes("You are not signed in to Hamzad. Run `hamzad auth login`") &&
      !output(staffRun).includes("No model is available"),
    { code: staffRun.code, output: output(staffRun).slice(-300) },
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

  // On a machine nobody signed in on, `/usage` says how to sign in, in Hamzad's words.
  if (process.platform !== "win32") {
    await interactive({ ...fresh("usage"), HAMZAD_DISABLE_AUTOUPDATE: "1" }, async (screen) => {
      await screen.until(() => screen.text().includes("Tell Hamzad what to do"))
      const start = screen.text().length
      screen.type("/usage")
      await Bun.sleep(500)
      screen.type("\r")
      // The sentence takes the place of "Loading…" on screen, and a terminal is sent only the cells
      // that change, so its first letters may not be written again: the rest of it is looked for.
      const sentence = "are not signed in to Hamzad. Run `hamzad auth login`"
      const said = await screen.until(() => screen.text().slice(start).includes(sentence), 30_000)
      check(
        "signed out, `/usage` says how to sign in to Hamzad",
        said && !/console|workspace|\/connect|opencode/i.test(screen.text().slice(start)),
        screen.text().slice(start).slice(-500),
      )
    })
  }

  // A project may keep its settings under this build's name: a model given there is the one used.
  if (bin) {
    await fs.writeFile(path.join(project, "hamzad.json"), JSON.stringify({ model: "hamzad/deepseek" }))
    const beforeNamed = gateway.requests.length
    await run(hello, second)
    await fs.rm(path.join(project, "hamzad.json"))
    check(
      "a project's `hamzad.json` is read",
      gateway.requests
        .slice(beforeNamed)
        .some((request) => request.body?.tools.length && request.body.model === "deepseek"),
      gateway.requests.slice(beforeNamed).map((request) => request.body?.model),
    )
  }

  // Updating, with a binary: where a new version is looked for, and what is said about it. No
  // archive is served, so nothing can be installed; what is asked for and what is said are checked.
  if (bin && process.platform !== "win32") {
    const current = version.stdout.trim().replace(/^hamzad v?/, "")
    const release = { version: "99.9.9" }
    const fetched: string[] = []
    const site = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        fetched.push(pathname)
        return pathname.endsWith(".json")
          ? Response.json({ version: release.version, metadata: { package: `${Brand.scope}/cli` } })
          : new Response("Not found", { status: 404 })
      },
    })
    const from = { HAMZAD_CLI_URL: `http://127.0.0.1:${site.port}`, HAMZAD_CLI_RELEASES: "" }
    try {
      const newer = await run(["upgrade", "--method", "curl"], from)
      check(
        "`upgrade` names the newer version, in Hamzad's words, and asks Hamzad's address for the installer",
        output(newer).includes(`From ${current} → 99.9.9`) &&
          !/opencode/i.test(output(newer)) &&
          fetched.some((item) => item.endsWith(".json")) &&
          fetched.includes("/install"),
        { output: output(newer).slice(-500), fetched },
      )
      release.version = current
      const same = await run(["upgrade", "--method", "curl"], from)
      check(
        "`upgrade` says so when the newest version is the one installed",
        output(same).includes(`Hamzad upgrade skipped: ${current} is already installed`),
        output(same).slice(-300),
      )

      // A copy the installer put in place updates itself when a new version is out, unless told not to.
      release.version = "99.9.9"
      const installed = path.join(home, Brand.dot, "bin", path.basename(bin))
      await fs.mkdir(path.dirname(installed), { recursive: true })
      await fs.link(bin, installed).catch(() => fs.copyFile(bin, installed))
      const settings = path.join(home, "config", "hamzad", "hamzad.json")
      // The interface is opened and left alone until `settled` holds, or for as long as given;
      // then for a moment more, in which the installer would be asked for if it were going to be.
      const looked = () => fetched.some((item) => item.endsWith(".json"))
      const starts = async (env: Record<string, string>, settled: () => boolean, milliseconds = 30_000) => {
        fetched.length = 0
        const child = Bun.spawn({
          cmd: [installed, "--standalone"],
          cwd: project,
          env: { ...environment, TERM: "xterm-256color", ...from, ...env },
          terminal: { cols: 140, rows: 45, data: () => {} },
        } as never)
        for (const end = Date.now() + milliseconds; Date.now() < end && !settled(); ) await Bun.sleep(250)
        await Bun.sleep(3000)
        child.kill()
        await child.exited
        return [...fetched]
      }
      const automatic = await starts({}, () => fetched.includes("/install"))
      check(
        "a new version is installed without asking, by default",
        looked() && automatic.includes("/install"),
        automatic,
      )
      await fs.mkdir(path.dirname(settings), { recursive: true })
      await fs.writeFile(settings, JSON.stringify({ update: "notify" }))
      const told = await starts({}, looked)
      check(
        'with `"update": "notify"` in `hamzad.json`, a new version is looked for and not installed',
        told.some((item) => item.endsWith(".json")) && !told.includes("/install"),
        told,
      )
      await fs.rm(settings)
      // Several times as long as a start needs before it asks.
      const quiet = await starts({ HAMZAD_DISABLE_AUTOUPDATE: "1" }, () => false, 12_000)
      check("with HAMZAD_DISABLE_AUTOUPDATE=1, nothing is asked for", quiet.length === 0, quiet)
      await fs.rm(path.join(home, Brand.dot), { recursive: true, force: true })
    } finally {
      await site.stop(true)
    }
  }

  // The built program itself: upstream's name nowhere a person reads it.
  if (bin) {
    const scan = Bun.spawn({
      cmd: [process.execPath, path.join(root, "hamzad/script/check-brand.ts"), bin],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [counted, named, code] = await Promise.all([
      new Response(scan.stdout).text(),
      new Response(scan.stderr).text(),
      scan.exited,
    ])
    console.log(counted.trimEnd().replace(/^/gm, "     "))
    check("the binary holds upstream's name nowhere a person reads it", code === 0, named.slice(0, 1500))
  }

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
