import { describe, expect, test } from "bun:test"
import { Brand } from "@opencode/util/brand"
import { HamzadUsageText } from "../../src/hamzad/usage-text"

describe.skipIf(!Brand.isHamzad)("the words of /usage", () => {
  test("a spent amount is to the hundredth, and a small one is not shown as nothing", () => {
    expect(HamzadUsageText.spent(0)).toBe("0.00")
    expect(HamzadUsageText.spent(0.0042)).toBe("<0.01")
    expect(HamzadUsageText.spent(1.2577)).toBe("1.26")
    expect(HamzadUsageText.spent(1234.5)).toBe("1,234.50")
  })

  test("requests are counted in words", () => {
    expect(HamzadUsageText.requests(0)).toBe("0 requests")
    expect(HamzadUsageText.requests(1)).toBe("1 request")
    expect(HamzadUsageText.requests(1200)).toBe("1,200 requests")
  })

  test("the table by model is lines of one width, with each model under its listed name", () => {
    const table = HamzadUsageText.table(
      [
        { id: "claude-haiku", requests: 5, credits: 1.2577, promptTokens: 15020, completionTokens: 61 },
        {
          id: "an-id-with-no-listed-name-that-runs-on",
          requests: 1200,
          credits: 0.001,
          promptTokens: 0,
          completionTokens: 0,
        },
      ],
      (id) => (id === "claude-haiku" ? "Claude Haiku 4.5" : id),
      70,
    )
    expect([table.head, ...table.rows]).toEqual([
      "Model                 Requests     Credits      Tokens in   Tokens out",
      "Claude Haiku 4.5             5        1.26         15,020           61",
      "an-id-with-no-liste…     1,200       <0.01              0            0",
    ])
    expect(new Set([table.head, ...table.rows].map((line) => line.length))).toEqual(new Set([70]))
  })
})
