import { describe, expect, test } from "bun:test"
import { askAgainSoon } from "../../src/hamzad/soon"

describe("a refused question to the CLI's own server", () => {
  test("is asked again after 1, 2, 4, 8 and 16 seconds, then left alone", () => {
    const waits: number[] = []
    const real = globalThis.setTimeout
    globalThis.setTimeout = ((ask: () => void, ms: number) => {
      waits.push(ms)
      return 0 as never
    }) as never
    try {
      const again = askAgainSoon()
      for (let refusal = 0; refusal < 7; refusal++) again.refused(() => {})
      expect(waits).toEqual([1000, 2000, 4000, 8000, 16000])
      again.answered()
      again.refused(() => {})
      expect(waits.at(-1)).toBe(1000)
    } finally {
      globalThis.setTimeout = real
    }
  })
})
