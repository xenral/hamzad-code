import { describe, expect, test } from "bun:test"
import { BoxRenderable, TextareaRenderable, TextRenderable, fg, t } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { HamzadRtl } from "@opencode/util/hamzad-rtl"
import { HamzadRtlFrame } from "../../src/hamzad/rtl-frame"

const quote = "> همزاد کنار کدت می‌نشیند: پروژه را می‌خواند، فایل‌ها را تغییر می‌دهد."
const plain = "متن ساده با عدد ۱۲۳ و کلمه‌ی English در وسط."

/** A frame drawn twice: as it was written, and laid out by the pass. */
async function frames(draw: (setup: Awaited<ReturnType<typeof createTestRenderer>>) => void, width = 90, height = 8) {
  const setup = await createTestRenderer({ width, height })
  draw(setup)
  await setup.renderOnce()
  const before = setup.captureCharFrame()
  setup.renderer.addPostProcessFn((buffer) => void HamzadRtlFrame.paint(buffer))
  setup.renderer.requestRender()
  await setup.renderOnce()
  return { setup, before, after: setup.captureCharFrame() }
}

describe("a frame's right-to-left text is laid out where it is drawn", () => {

  test("no two right-to-left letters share a run of alike cells, and no colour moves more than a step of blue", async () => {
    const { setup } = await frames(({ renderer }) => {
      renderer.root.add(new TextRenderable(renderer, { content: `The answer: ${quote}` }))
    })
    const spans = setup.captureSpans().lines[0].spans
    // VS Code's terminal without the GPU hands each such run to the browser, which would reorder it.
    const letters = /(?!\p{M})[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/gu
    expect(spans.some((span) => (span.text.match(letters) ?? []).length > 0)).toBe(true)
    for (const span of spans) expect((span.text.match(letters) ?? []).length).toBeLessThanOrEqual(1)
    expect(spans[0].text.startsWith("The answer:")).toBe(true)
    for (const plane of ["fg", "bg"] as const) {
      const [r, g, b] = spans[0][plane].toInts()
      for (const span of spans) {
        const [r2, g2, b2] = span[plane].toInts()
        expect([r2, g2]).toEqual([r, g])
        expect(Math.abs(b2 - b)).toBeLessThanOrEqual(1)
      }
    }
  })

  test("each row reads right to left with joined letters, and borders stay where they were", async () => {
    const { before, after, setup } = await frames(({ renderer }) => {
      const box = new BoxRenderable(renderer, { border: true, width: 90, height: 8, flexDirection: "column" })
      for (const content of [quote, plain, "all English here", "כתוב בעברית 42"])
        box.add(new TextRenderable(renderer, { content }))
      renderer.root.add(box)
    })
    expect(setup.renderer.root).toBeDefined()
    expect(before).toContain(quote)
    const rows = after.split("\n")
    expect(rows).toEqual(before.split("\n").map((row) => HamzadRtl.text(row)))
    expect(rows[1]).toContain(HamzadRtl.text(quote))
    expect(rows[2]).toContain(".ﻂﺳﻭ ﺭﺩ English ﯼﻪﻤﻠﮐ ﻭ ۱۲۳ ﺩﺪﻋ ﺎﺑ ﻩﺩﺎﺳ ﻦﺘﻣ")
    expect(rows[3]).toBe(before.split("\n")[3])
    // every border cell is where it was: the columns of each row's borders, counted in cells
    const borders = (frame: string) =>
      frame.split("\n").map((row) => {
        let column = 0
        const found: string[] = []
        for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(row)) {
          if (/[\u2500-\u259f]/.test(segment)) found.push(`${column}${segment}`)
          column += Bun.stringWidth(segment)
        }
        return found.join(" ")
      })
    expect(borders(after)).toEqual(borders(before))
  })

  test("two panes on one row are laid out each on its own", async () => {
    const { before, after } = await frames(({ renderer }) => {
      const row = new BoxRenderable(renderer, { flexDirection: "row", width: 60, height: 3 })
      row.add(new BoxRenderable(renderer, { border: true, width: 30, height: 3 }))
      row.add(new BoxRenderable(renderer, { border: true, width: 30, height: 3 }))
      row.getChildren()[0].add(new TextRenderable(renderer, { content: "سلام دنیا" }))
      row.getChildren()[1].add(new TextRenderable(renderer, { content: "left پنل" }))
      renderer.root.add(row)
    }, 60, 3)
    expect(before.split("\n")[1]).toContain("│سلام دنیا")
    expect(after.split("\n")[1]).toBe("│" + "ﺎﯿﻧﺩ ﻡﺎﻠﺳ".padEnd(28) + "││" + "left ﻞﻨﭘ".padEnd(28) + "│")
  })

  test("cells move with their colours", async () => {
    const { setup } = await frames(({ renderer }) => {
      renderer.root.add(new TextRenderable(renderer, { content: t`سلام ${fg("#ff0000")("دنیا")}` }))
    }, 20, 1)
    const spans = setup.captureSpans().lines[0].spans
    // Each moved cell is a run of its own (see below), so the red ones are joined.
    const red = spans.filter((span) => span.fg.toInts()[0] === 255 && span.fg.toInts()[1] === 0)
    // دنیا is the end of the sentence, so it is drawn on the left, still red
    expect(red.map((span) => span.text).join("")).toBe("ﺎﯿﻧﺩ")
    expect(spans.map((span) => span.text).join("").startsWith("ﺎﯿﻧﺩ")).toBe(true)
  })

  test("the same frame drawn again comes out the same", async () => {
    const { setup, after } = await frames(({ renderer }) => {
      renderer.root.add(new TextRenderable(renderer, { content: plain }))
    }, 60, 2)
    for (let i = 0; i < 3; i++) {
      setup.renderer.requestRender()
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toBe(after)
    }
  })

  test("selecting and copying gives the text as it was written", async () => {
    const { setup } = await frames(({ renderer }) => {
      renderer.root.add(new TextRenderable(renderer, { content: "سلام دنیا", selectable: true }))
    }, 20, 2)
    await setup.mockMouse.drag(0, 0, 9, 0)
    await setup.renderOnce()
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("سلام دنیا")
  })
})

describe("the cursor follows Persian typed in a text field", () => {
  test("after the last letter it is just left of the words, and an English word puts it on the right", async () => {
    const setup = await createTestRenderer({ width: 30, height: 3 })
    const field = new TextareaRenderable(setup.renderer, { width: 20, height: 1, left: 5, top: 1 })
    setup.renderer.root.add(field)
    field.focus()
    setup.renderer.addPostProcessFn((buffer) => {
      const state = setup.renderer.getCursorState()
      const cursor = state.visible ? { x: state.x - 1, y: state.y - 1 } : undefined
      const caret = HamzadRtlFrame.paint(buffer, cursor)
      if (caret) setup.renderer.setCursorPosition(caret.x + 1, caret.y + 1, true)
    })
    await setup.mockInput.typeText("سلام")
    await setup.renderOnce()
    expect(setup.captureCharFrame().split("\n")[1]).toBe("     ﻡﺎﻠﺳ" + " ".repeat(21))
    // one cell left of the words, where the next letter is seen to go
    expect(setup.renderer.getCursorState()).toMatchObject({ x: 5, y: 2 })
    await setup.mockInput.typeText(" ")
    await setup.renderOnce()
    expect(setup.renderer.getCursorState()).toMatchObject({ x: 5, y: 2 })
    await setup.mockInput.typeText("ab")
    await setup.renderOnce()
    expect(setup.captureCharFrame().split("\n")[1].trimEnd()).toBe("     ab ﻡﺎﻠﺳ")
    // right after "ab": column 7, so the terminal's 1-based 8
    expect(setup.renderer.getCursorState()).toMatchObject({ x: 8, y: 2 })
  })
})
