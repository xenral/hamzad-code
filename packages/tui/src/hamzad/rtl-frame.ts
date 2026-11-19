export * as HamzadRtlFrame from "./rtl-frame.js"

// The interface's frames with their right-to-left text laid out for a terminal that draws text as it
// is written. A finished frame is gone over row by row, after everything has drawn into it and before
// it is written out: cells move with their own colours and attributes, so a highlighted word, inline
// code or a link stays on its letters, and the letters that change form are drawn again through the
// buffer's own drawing, which keeps its count of the clusters it holds. The text the interface holds
// is not touched, so selecting and copying still give the letters as they were written.

import { RGBA, type OptimizedBuffer } from "@opentui/core"
import { HamzadRtl } from "@opencode/util/hamzad-rtl"

interface Cells {
  readonly width: number
  readonly height: number
  readonly char: Uint32Array
  readonly fg: Uint16Array
  readonly bg: Uint16Array
  readonly attributes: Uint32Array
}

// OpenTUI keeps a cluster that is not one ASCII character in a pool and the cell holds its number, so
// the text of a cell is read through the buffer's own resolution of it, with the bytes each cell took.
type Resolve = (
  options: { addLineBreaks: boolean; cellLengths: boolean },
  use: (bytes: Uint8Array, cells: Cells, lengths: Uint8Array) => void,
) => void

// A cell whose top two bits are set continues the wide glyph to its left.
const continuation = (char: number) => char >>> 30 === 3
const decoder = new TextDecoder()

/**
 * Whether UTF-8 holds a character that may be a right-to-left letter: the lead bytes of U+0580 to
 * U+077F, U+0880 to U+08FF, and U+FB00 to U+FEFF. Only a quick look: the layout decides.
 */
function maybe(bytes: Uint8Array, from: number, to: number) {
  for (let i = from; i < to; i++) {
    const byte = bytes[i]
    if (byte < 0xd6) continue
    if (byte <= 0xdd) return true
    if (byte === 0xe0 && (bytes[i + 1] === 0xa2 || bytes[i + 1] === 0xa3)) return true
    if (byte === 0xef && bytes[i + 1] >= 0xac && bytes[i + 1] <= 0xbb) return true
  }
  return false
}

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Lays out the right-to-left text in a finished frame. `cursor` is where the terminal's cursor is
 * (from 0); when it is inside text that moved, the place where it should be seen is returned.
 */
export function paint(buffer: OptimizedBuffer, cursor?: Point): Point | undefined {
  const resolve = (buffer as unknown as { withResolvedChars?: Resolve }).withResolvedChars
  if (typeof resolve !== "function") return undefined
  let caret: Point | undefined
  resolve.call(buffer, { addLineBreaks: false, cellLengths: true }, (bytes, cells, lengths) => {
    if (!maybe(bytes, 0, bytes.length)) return
    const { width, height } = cells
    let offset = 0
    for (let y = 0; y < height; y++) {
      const start = offset
      for (let x = 0; x < width; x++) offset += lengths[y * width + x]
      if (!maybe(bytes, start, offset)) continue
      const moved = row(buffer, cells, bytes, lengths, y, start, cursor?.y === y ? cursor.x : undefined)
      if (moved !== undefined) caret = { x: moved, y }
    }
  })
  return caret
}

function row(
  buffer: OptimizedBuffer,
  cells: Cells,
  bytes: Uint8Array,
  lengths: Uint8Array,
  y: number,
  offset: number,
  cursorX: number | undefined,
) {
  const { width, char, fg, bg, attributes } = cells
  const base = y * width
  const glyphs: { text: string; width: number }[] = []
  const starts: number[] = []
  let at = offset
  for (let x = 0; x < width; x++) {
    const length = lengths[base + x]
    if (continuation(char[base + x]) && glyphs.length > 0) glyphs[glyphs.length - 1].width++
    else {
      glyphs.push({
        text: length === 1 ? String.fromCharCode(bytes[at]) : decoder.decode(bytes.subarray(at, at + length)),
        width: 1,
      })
      starts.push(x)
    }
    at += length
  }
  const cursor =
    cursorX === undefined
      ? undefined
      : ((index) => (index === -1 ? glyphs.length : index))(starts.findIndex((start) => start >= cursorX))
  const layout = HamzadRtl.layout(glyphs, cursor)
  if (!layout) return undefined

  // The row as it was drawn, to move cells from.
  const was = {
    char: char.slice(base, base + width),
    fg: fg.slice(base * 4, (base + width) * 4),
    bg: bg.slice(base * 4, (base + width) * 4),
    attributes: attributes.slice(base, base + width),
  }
  const columns = new Array<number>(layout.order.length + 1)
  const changed: [number, string][] = []
  let x = 0
  layout.order.forEach((glyph, place) => {
    columns[place] = x
    const from = starts[glyph]
    const size = glyphs[glyph].width
    if (from !== x)
      for (let k = 0; k < size; k++) {
        const target = base + x + k
        char[target] = was.char[from + k]
        attributes[target] = was.attributes[from + k]
        fg.set(was.fg.subarray((from + k) * 4, (from + k) * 4 + 4), target * 4)
        bg.set(was.bg.subarray((from + k) * 4, (from + k) * 4 + 4), target * 4)
      }
    const text = layout.text.get(glyph)
    if (text !== undefined) changed.push([x, text])
    x += size
  })
  columns[layout.order.length] = x

  // A letter in another form is drawn anew, which lets the buffer release the cluster it replaces;
  // its colours and attributes, a link among them, are then put back as they were.
  for (const [column, text] of changed) {
    const cell = base + column
    const fore = fg.slice(cell * 4, cell * 4 + 4)
    const back = bg.slice(cell * 4, cell * 4 + 4)
    const attribute = attributes[cell]
    const single = text.length === 1 || (text.length === 2 && text.codePointAt(0)! > 0xffff)
    if (single) buffer.setCell(column, y, text, RGBA.fromArray(fore), RGBA.fromArray(back), attribute & 0xff)
    else buffer.drawText(text, column, y, RGBA.fromArray(fore), RGBA.fromArray(back), attribute & 0xff)
    fg.set(fore, cell * 4)
    bg.set(back, cell * 4)
    attributes[cell] = attribute
  }

  if (layout.caret === undefined) return undefined
  const column = layout.caret < 0 ? -1 : columns[Math.min(layout.caret, layout.order.length)]
  return Math.max(0, Math.min(width - 1, column))
}
