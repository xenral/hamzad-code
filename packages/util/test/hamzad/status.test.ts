import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

const status = pathToFileURL(path.join(import.meta.dir, "../../src/hamzad-status.ts")).href

describe("Hamzad's states in words", () => {
  test("an empty model list has one line for each reason, and none when the list is there", () => {
    expect(
      run(
        `const { HamzadStatus } = await import(${JSON.stringify(status)}); console.log(JSON.stringify(Object.fromEntries(HamzadStatus.states.map((state) => [state, HamzadStatus.reason(state) ?? null]))))`,
      ),
    ).toEqual({
      listed: null,
      "sign-in": "Sign in to see Hamzad's models: run `hamzad auth login`.",
      refused: "Hamzad did not accept this sign-in. Run `hamzad auth login` to sign in again.",
      "no-access": "This account does not have access to Hamzad's API yet.",
      unavailable: "Hamzad's API for tools is not available yet.",
      unreachable: "Could not reach Hamzad. Check your connection and try again.",
    })
  })

  test("a prompt with no model to go to gets the same reasons, and is told how to sign in", () => {
    expect(
      run(
        `const { HamzadStatus } = await import(${JSON.stringify(status)}); console.log(JSON.stringify(["listed", "sign-in", "unavailable", "no-access", "unreachable"].map((state) => HamzadStatus.prompt(state) ?? null)))`,
      ),
    ).toEqual([
      null,
      "You are not signed in to Hamzad. Run `hamzad auth login` and approve this device in your panel.",
      "Hamzad's API for tools is not available yet.",
      "This account does not have access to Hamzad's API yet.",
      "Could not reach Hamzad. Check your connection and try again.",
    ])
  })

  test("a sign-in that cannot go on is worded by its code, with a plain sentence for any other", () => {
    expect(
      run(
        `const { HamzadStatus } = await import(${JSON.stringify(status)}); console.log(JSON.stringify(["auth.device_unavailable", "resource.not_found", "auth.device_attempts", "access_denied", "status_502", "unreachable"].map(HamzadStatus.signIn)))`,
      ),
    ).toEqual([
      "Hamzad's API for tools is not available yet.",
      "Hamzad's API for tools is not available yet.",
      "Too many sign-in attempts. Try again in a little while.",
      "The sign-in was declined in the panel.",
      "Hamzad could not complete the sign-in. Try again in a little while.",
      "Could not reach Hamzad to sign in. Check your connection and try again.",
    ])
  })

  test("the server's answer is read only when it names a known state", () => {
    expect(
      run(
        `const { HamzadStatus } = await import(${JSON.stringify(status)}); console.log(JSON.stringify([{ models: "unavailable" }, { models: "something-new" }, null, "listed"].map((answer) => HamzadStatus.read(answer) ?? null)))`,
      ),
    ).toEqual(["unavailable", null, null, null])
  })
})

function run(script: string) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry) => !entry[0].startsWith("HAMZAD_") && !entry[0].startsWith("OPENCODE_")),
  )
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    env: inherited,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}
