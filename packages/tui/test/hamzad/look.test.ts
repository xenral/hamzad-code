import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { Brand } from "@opencode/util/brand"
import { HamzadNames } from "../../src/hamzad/names"
import { HamzadSignIn } from "../../src/hamzad/sign-in"
import { HamzadTheme } from "../../src/hamzad/theme"
import { along, rows } from "../../src/hamzad/logo"
import { allThemes, defaultThemeName } from "../../src/theme"

const hex = (color: RGBA) =>
  `#${color
    .toInts()
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase()

describe.skipIf(!Brand.isHamzad)("Hamzad's look", () => {
  test("the theme is the default, and upstream's themes are still there under a name that is not upstream's", () => {
    expect(defaultThemeName).toBe("hamzad")
    expect(Object.keys(allThemes())).toEqual(expect.arrayContaining(["hamzad", "opencode", "dracula"]))
    expect(["hamzad", "opencode", "opencode2", "dracula"].map(HamzadTheme.title)).toEqual([
      "Hamzad",
      "Classic",
      "Classic (new designs)",
      "dracula",
    ])
  })

  test("the colours are the site's, in the dark and in the light", () => {
    const colours = (mode: "dark" | "light") => {
      const theme = resolveThemeDocument(HamzadTheme.document(), mode)
      const hue = theme.hue as unknown as Record<string, Record<number, RGBA>>
      return {
        background: hex(theme.background.base),
        panel: hex(theme.background.raised.base),
        element: hex(theme.background.raised.high),
        text: hex(theme.text.base),
        muted: hex(theme.text.muted),
        primary: hex(theme.hue.interactive[200]!),
        secondary: hex(hue.secondary![200]!),
        accent: hex(theme.hue.accent[200]!),
        success: hex(theme.text.feedback.success.base),
        error: hex(theme.text.feedback.error.base),
      }
    }
    expect(colours("dark")).toEqual({
      background: "#080514",
      panel: "#120E1F",
      element: "#1B1630",
      text: "#F5F4F7",
      muted: "#A39EB6",
      primary: "#AE8BFF",
      secondary: "#CB68FF",
      accent: "#5AD1FC",
      success: "#4ADE9B",
      error: "#FF7A7A",
    })
    expect(colours("light")).toEqual({
      background: "#FAFAFC",
      panel: "#FFFFFF",
      element: "#F2F2F6",
      text: "#0B0B12",
      muted: "#52525E",
      primary: "#6424D6",
      secondary: "#A063E9",
      accent: "#2A47E6",
      success: "#0F7547",
      error: "#C8243A",
    })
  })

  test("the wordmark runs through the stops from its first column to its last", () => {
    const stops = [RGBA.fromHex("#CB68FF"), RGBA.fromHex("#AE8BFF"), RGBA.fromHex("#5AD1FC")]
    expect([0, 0.5, 1].map((position) => hex(along(stops, position)))).toEqual(["#CB68FF", "#AE8BFF", "#5AD1FC"])
    expect(hex(along([stops[1]!], 0.7))).toBe("#AE8BFF")
    // One word side by side when there is room, one half above the other when not.
    expect(rows(120)).toHaveLength(4)
    expect(new Set(rows(120).map((line) => Array.from(line).length)).size).toBe(1)
    expect(rows(40)).toHaveLength(7)
  })

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
