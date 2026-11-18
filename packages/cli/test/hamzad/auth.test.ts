import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { Effect, Exit } from "effect"
import { HamzadAuth } from "../../src/hamzad/auth"

const stored = (id: string, label: string) => ({ type: "credential" as const, id, label, method: "oauth" as const })
const integration = (id: string, connections: IntegrationInfo["connections"]): IntegrationInfo => ({
  id,
  name: id === "hamzad" ? "Hamzad" : id,
  methods: [],
  connections,
})

describe.skipIf(!Brand.isHamzad)("Hamzad's auth commands", () => {
  test("with no argument, login and logout mean Hamzad", () => {
    expect(HamzadAuth.target(undefined)).toBe("hamzad")
    expect(HamzadAuth.target("exa")).toBe("exa")
  })

  test("a Hamzad sign-in goes to the approval in the panel unless another way is named", () => {
    expect(HamzadAuth.method("hamzad", undefined)).toBe("device")
    expect(HamzadAuth.method("hamzad", "key")).toBe("key")
    expect(HamzadAuth.method("exa", undefined)).toBeUndefined()
  })

  test("logout takes the one stored Hamzad sign-in without asking", async () => {
    expect(await Effect.runPromise(HamzadAuth.only(integration("hamzad", [stored("cred_1", "+98912•••0001")])))).toBe(
      "cred_1",
    )
    // A key from the environment is not a stored sign-in.
    expect(
      await Effect.runPromise(
        HamzadAuth.only(
          integration("hamzad", [{ type: "env", name: "HAMZAD_API_KEY" }, stored("cred_1", "+98912•••0001")]),
        ),
      ),
    ).toBe("cred_1")
  })

  test("with no stored sign-in there is nothing to pick, and the caller says so", async () => {
    expect(await Effect.runPromise(HamzadAuth.only(integration("hamzad", [])))).toBeUndefined()
  })

  // The test run has no terminal, which is the case that used to need the label typed out.
  test("several sign-ins, or another integration, still need a terminal to pick from", async () => {
    const several = await Effect.runPromiseExit(
      HamzadAuth.only(integration("hamzad", [stored("cred_1", "one"), stored("cred_2", "two")])),
    )
    const other = await Effect.runPromiseExit(HamzadAuth.only(integration("exa", [stored("cred_3", "exa")])))
    expect(Exit.isFailure(several)).toBe(true)
    expect(Exit.isFailure(other)).toBe(true)
  })

  test("`auth list` marks the first of several sign-ins as the one in use", () => {
    const both = integration("hamzad", [{ type: "env", name: "HAMZAD_API_KEY" }, stored("cred_1", "+98912•••0001")])
    expect(HamzadAuth.inUse(both, 0)).toBe(", in use")
    expect(HamzadAuth.inUse(both, 1)).toBe("")
    expect(HamzadAuth.inUse(integration("hamzad", [stored("cred_1", "one")]), 0)).toBe("")
  })
})
