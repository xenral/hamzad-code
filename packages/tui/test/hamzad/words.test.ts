import { describe, expect, test } from "bun:test"
import { Brand } from "@opencode/util/brand"
import { HamzadNames } from "../../src/hamzad/names"
import { HamzadSignIn } from "../../src/hamzad/sign-in"

describe.skipIf(!Brand.isHamzad)("Hamzad's words", () => {
  test("the agent that writes code is called Code; other agents keep their names", () => {
    expect(["build", "plan", "explore"].map(HamzadNames.agent)).toEqual(["Code", "Plan", "Explore"])
    expect(HamzadNames.entry("plan")).toBe("Plan")
    expect(HamzadNames.label("build", "Build")).toBe("Code")
  })

  test("the model picker offers nothing to connect while Hamzad is the only provider", () => {
    const actions = [{ command: "model.dialog.provider" }, { command: "model.dialog.favorite" }]
    const before = process.env.HAMZAD_UPSTREAM_PROVIDERS
    try {
      delete process.env.HAMZAD_UPSTREAM_PROVIDERS
      expect(HamzadSignIn.offered(actions).map((action) => action.command)).toEqual(["model.dialog.favorite"])
      process.env.HAMZAD_UPSTREAM_PROVIDERS = "1"
      expect(HamzadSignIn.offered(actions)).toEqual(actions)
    } finally {
      if (before === undefined) delete process.env.HAMZAD_UPSTREAM_PROVIDERS
      else process.env.HAMZAD_UPSTREAM_PROVIDERS = before
    }
  })
})
