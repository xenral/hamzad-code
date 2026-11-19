export * as HamzadRtl from "./hamzad-rtl.js"

// Persian, Arabic and Hebrew for terminals that do no bidirectional layout and no Arabic shaping
// themselves, as VS Code's does: they draw a line in the order it was written, left to right, each
// letter alone in its cell. Here a line is turned into what such a terminal should be given: the
// right-to-left parts in the order they are seen, and each Arabic-script letter in the form it takes
// beside its neighbours. Every glyph keeps its cell, so nothing around it moves.
//
// It is the Unicode bidirectional algorithm (UAX #9) in a simple form: no explicit embeddings, and a
// right-to-left part of a line laid out as a paragraph of its own, from its first right-to-left letter
// to its last one, or to the end of the line when the line itself is right-to-left.

/** One glyph as a terminal draws it: a grapheme cluster, and the cells it takes (2 for a wide one). */
export interface Glyph {
  readonly text: string
  readonly width: number
}

export interface Layout {
  /** For each place on the line, left to right, the glyph drawn there, by its place in the text. */
  readonly order: readonly number[]
  /** Glyphs drawn with other characters than they hold: a letter in its joined form, a mirrored bracket. */
  readonly text: ReadonlyMap<number, string>
  /**
   * Where a caret before the glyph given as the cursor is seen, as a place in `order` (-1 is the cell
   * before the line). Only when the cursor is inside a right-to-left part.
   */
  readonly caret?: number
}

// The bidirectional types this layout tells apart.
const L = 0 // a left-to-right letter
const R = 1 // a right-to-left letter (Hebrew)
const AL = 2 // a right-to-left letter (Arabic script)
const EN = 3 // a European digit (and Persian ones)
const AN = 4 // an Arabic digit
const ES = 5 // + -
const ET = 6 // % # $ and such, which belong to a number beside them
const CS = 7 // , . : / between digits
const NSM = 8 // a mark on the glyph before it
const WS = 9 // a space
const ON = 10 // anything else
type Kind = number

const letter = /\p{L}/u
const mark = /\p{M}/u
const currency = /\p{Sc}/u
const number = /\p{N}/u
const space = /\s/u

/** The right-to-left letters: Arabic script and Hebrew, without their digits, separators and marks. */
function rtl(cp: number) {
  return (
    (cp >= 0x0590 && cp <= 0x05ff) ||
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfb4f) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfefe)
  )
}

function kind(text: string): Kind {
  const cp = text.codePointAt(0)
  if (cp === undefined) return WS
  if (cp < 0x80) {
    if (cp >= 0x30 && cp <= 0x39) return EN
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return L
    if (cp === 0x20 || cp === 0x09) return WS
    if (cp === 0x2b || cp === 0x2d) return ES
    if (cp === 0x23 || cp === 0x24 || cp === 0x25) return ET
    if (cp === 0x2c || cp === 0x2e || cp === 0x2f || cp === 0x3a) return CS
    return ON
  }
  if (cp >= 0x06f0 && cp <= 0x06f9) return EN
  if (
    (cp >= 0x0660 && cp <= 0x0669) ||
    cp === 0x066b ||
    cp === 0x066c ||
    (cp >= 0x0600 && cp <= 0x0605) ||
    cp === 0x06dd
  )
    return AN
  if (cp === 0x066a || cp === 0x0609 || cp === 0x060a) return ET
  if (cp === 0x060c || cp === 0x00a0) return CS
  if (cp === 0x200e) return L
  if (cp === 0x200f) return R
  if (cp === 0x061c) return AL
  // The glyph's first character decides: what follows it in a cluster is marks and joiners.
  const char = String.fromCodePoint(cp)
  if (mark.test(char)) return NSM
  if (rtl(cp)) return cp <= 0x05ff || (cp >= 0xfb1d && cp <= 0xfb4f) ? R : AL
  if (cp === 0x2212) return ES
  if (cp === 0xb0 || cp === 0x2030 || cp === 0x2031 || currency.test(char)) return ET
  if (space.test(char)) return WS
  if (letter.test(char) || number.test(char)) return L
  return ON
}

const strongRtl = (type: Kind) => type === R || type === AL
const neutral = (type: Kind) => type === ON || type === CS || type === ES || type === ET

/** Box-drawing and block characters: the borders between panes, which no line of text crosses. */
const border = (text: string) => {
  const cp = text.codePointAt(0) ?? 0
  return cp >= 0x2500 && cp <= 0x259f
}

const blank = (text: string) => text === " " || text === ""

// The brackets that pair up (BD16): ( ) [ ] { } and the guillemets « », opening to closing.
const brackets = new Map<number, number>([
  [0x28, 0x29],
  [0x5b, 0x5d],
  [0x7b, 0x7d],
  [0xab, 0xbb],
])
const closers = new Map([...brackets].map(([open, close]) => [close, open]))

/** The bracket pairs among neutral glyphs, as indices from `from`, ordered by their opening bracket. */
function pairs(glyphs: readonly Glyph[], from: number, types: readonly Kind[]) {
  const open: { close: number; at: number }[] = []
  const found: [number, number][] = []
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== ON) continue
    const cp = glyphs[from + i].text.codePointAt(0)!
    const close = brackets.get(cp)
    if (close !== undefined) {
      // As the algorithm does, a line with brackets nested deeper than 63 pairs no further.
      if (open.length === 63) break
      open.push({ close, at: i })
      continue
    }
    if (!closers.has(cp)) continue
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].close !== cp) continue
      found.push([open[k].at, i])
      open.length = k
      break
    }
  }
  return found.sort((a, b) => a[0] - b[0])
}

// Brackets and quotation marks drawn mirrored inside right-to-left text.
const mirrors = new Map<number, number>(
  [
    [0x28, 0x29],
    [0x3c, 0x3e],
    [0x5b, 0x5d],
    [0x7b, 0x7d],
    [0xab, 0xbb],
    [0x2039, 0x203a],
  ].flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ]),
)

// Each Arabic-script letter that has presentation forms: isolated, final, initial, medial (0 where
// there is none). From Unicode's compatibility decompositions of Presentation Forms-A and -B; the
// ligatures there are left out, so every letter keeps a cell of its own.
// prettier-ignore
const table: readonly (readonly [number, number, number, number, number])[] = [
  [0x621, 0xfe80, 0, 0, 0], [0x622, 0xfe81, 0xfe82, 0, 0], [0x623, 0xfe83, 0xfe84, 0, 0],
  [0x624, 0xfe85, 0xfe86, 0, 0], [0x625, 0xfe87, 0xfe88, 0, 0], [0x626, 0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  [0x627, 0xfe8d, 0xfe8e, 0, 0], [0x628, 0xfe8f, 0xfe90, 0xfe91, 0xfe92], [0x629, 0xfe93, 0xfe94, 0, 0],
  [0x62a, 0xfe95, 0xfe96, 0xfe97, 0xfe98], [0x62b, 0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  [0x62c, 0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], [0x62d, 0xfea1, 0xfea2, 0xfea3, 0xfea4],
  [0x62e, 0xfea5, 0xfea6, 0xfea7, 0xfea8], [0x62f, 0xfea9, 0xfeaa, 0, 0], [0x630, 0xfeab, 0xfeac, 0, 0],
  [0x631, 0xfead, 0xfeae, 0, 0], [0x632, 0xfeaf, 0xfeb0, 0, 0], [0x633, 0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  [0x634, 0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], [0x635, 0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  [0x636, 0xfebd, 0xfebe, 0xfebf, 0xfec0], [0x637, 0xfec1, 0xfec2, 0xfec3, 0xfec4],
  [0x638, 0xfec5, 0xfec6, 0xfec7, 0xfec8], [0x639, 0xfec9, 0xfeca, 0xfecb, 0xfecc],
  [0x63a, 0xfecd, 0xfece, 0xfecf, 0xfed0], [0x641, 0xfed1, 0xfed2, 0xfed3, 0xfed4],
  [0x642, 0xfed5, 0xfed6, 0xfed7, 0xfed8], [0x643, 0xfed9, 0xfeda, 0xfedb, 0xfedc],
  [0x644, 0xfedd, 0xfede, 0xfedf, 0xfee0], [0x645, 0xfee1, 0xfee2, 0xfee3, 0xfee4],
  [0x646, 0xfee5, 0xfee6, 0xfee7, 0xfee8], [0x647, 0xfee9, 0xfeea, 0xfeeb, 0xfeec], [0x648, 0xfeed, 0xfeee, 0, 0],
  [0x649, 0xfeef, 0xfef0, 0xfbe8, 0xfbe9], [0x64a, 0xfef1, 0xfef2, 0xfef3, 0xfef4], [0x671, 0xfb50, 0xfb51, 0, 0],
  [0x677, 0xfbdd, 0, 0, 0], [0x679, 0xfb66, 0xfb67, 0xfb68, 0xfb69], [0x67a, 0xfb5e, 0xfb5f, 0xfb60, 0xfb61],
  [0x67b, 0xfb52, 0xfb53, 0xfb54, 0xfb55], [0x67e, 0xfb56, 0xfb57, 0xfb58, 0xfb59],
  [0x67f, 0xfb62, 0xfb63, 0xfb64, 0xfb65], [0x680, 0xfb5a, 0xfb5b, 0xfb5c, 0xfb5d],
  [0x683, 0xfb76, 0xfb77, 0xfb78, 0xfb79], [0x684, 0xfb72, 0xfb73, 0xfb74, 0xfb75],
  [0x686, 0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], [0x687, 0xfb7e, 0xfb7f, 0xfb80, 0xfb81], [0x688, 0xfb88, 0xfb89, 0, 0],
  [0x68c, 0xfb84, 0xfb85, 0, 0], [0x68d, 0xfb82, 0xfb83, 0, 0], [0x68e, 0xfb86, 0xfb87, 0, 0],
  [0x691, 0xfb8c, 0xfb8d, 0, 0], [0x698, 0xfb8a, 0xfb8b, 0, 0], [0x6a4, 0xfb6a, 0xfb6b, 0xfb6c, 0xfb6d],
  [0x6a6, 0xfb6e, 0xfb6f, 0xfb70, 0xfb71], [0x6a9, 0xfb8e, 0xfb8f, 0xfb90, 0xfb91],
  [0x6ad, 0xfbd3, 0xfbd4, 0xfbd5, 0xfbd6], [0x6af, 0xfb92, 0xfb93, 0xfb94, 0xfb95],
  [0x6b1, 0xfb9a, 0xfb9b, 0xfb9c, 0xfb9d], [0x6b3, 0xfb96, 0xfb97, 0xfb98, 0xfb99], [0x6ba, 0xfb9e, 0xfb9f, 0, 0],
  [0x6bb, 0xfba0, 0xfba1, 0xfba2, 0xfba3], [0x6be, 0xfbaa, 0xfbab, 0xfbac, 0xfbad], [0x6c0, 0xfba4, 0xfba5, 0, 0],
  [0x6c1, 0xfba6, 0xfba7, 0xfba8, 0xfba9], [0x6c5, 0xfbe0, 0xfbe1, 0, 0], [0x6c6, 0xfbd9, 0xfbda, 0, 0],
  [0x6c7, 0xfbd7, 0xfbd8, 0, 0], [0x6c8, 0xfbdb, 0xfbdc, 0, 0], [0x6c9, 0xfbe2, 0xfbe3, 0, 0],
  [0x6cb, 0xfbde, 0xfbdf, 0, 0], [0x6cc, 0xfbfc, 0xfbfd, 0xfbfe, 0xfbff], [0x6d0, 0xfbe4, 0xfbe5, 0xfbe6, 0xfbe7],
  [0x6d2, 0xfbae, 0xfbaf, 0, 0], [0x6d3, 0xfbb0, 0xfbb1, 0, 0],
]
const forms = new Map(table.map(([base, ...shapes]) => [base, shapes] as const))

/** The letters' forms, base letter by base letter, for the tests. */
export const presentation: ReadonlyMap<number, readonly number[]> = forms

const ZWNJ = 0x200c
const ZWJ = 0x200d
const TATWEEL = 0x0640

// How a glyph joins its neighbours: on both sides (dual), only to the letter before it (right),
// causes a join (tatweel, ZWJ), is passed over (a mark alone), or does not join. A letter with no
// presentation forms is drawn alone whatever its neighbours are, so they do not join it either.
const DUAL = 1
const RIGHT = 2
const CAUSING = 3
const TRANSPARENT = 4
const NONE = 0

function joining(text: string) {
  const cp = text.codePointAt(0) ?? 0
  if (cp === TATWEEL || cp === ZWJ) return CAUSING
  const shapes = forms.get(cp)
  if (shapes) return shapes[2] ? DUAL : shapes[1] ? RIGHT : NONE
  if (mark.test(String.fromCodePoint(cp))) return TRANSPARENT
  return NONE
}

/** Whether a cluster ends in ZWNJ (no join after it) or ZWJ (a join after it). */
function tail(text: string) {
  for (let i = text.length - 1; i > 0; i--) {
    const code = text.charCodeAt(i)
    if (code === ZWNJ) return ZWNJ
    if (code === ZWJ) return ZWJ
  }
  return 0
}

/** The letter drawn in one of its forms, with the marks it carries; ZWNJ and ZWJ have done their work. */
function shaped(text: string, form: number) {
  let marks = ""
  for (const char of text.slice(text.codePointAt(0)! > 0xffff ? 2 : 1)) {
    const code = char.codePointAt(0)!
    if (code !== ZWNJ && code !== ZWJ) marks += char
  }
  return String.fromCodePoint(form) + marks
}

function shape(glyphs: readonly Glyph[], from: number, to: number, text: Map<number, string>) {
  const types = new Array<number>(to - from + 1)
  for (let i = from; i <= to; i++) types[i - from] = joining(glyphs[i].text)
  const type = (i: number) => types[i - from]
  for (let i = from; i <= to; i++) {
    const own = type(i)
    if (own !== DUAL && own !== RIGHT) continue
    let before = i - 1
    while (before >= from && type(before) === TRANSPARENT) before--
    let after = i + 1
    while (after <= to && type(after) === TRANSPARENT) after++
    const previous = before >= from ? glyphs[before].text : undefined
    const joinsBefore =
      previous !== undefined &&
      tail(previous) !== ZWNJ &&
      (type(before) === DUAL || type(before) === CAUSING || tail(previous) === ZWJ)
    const end = tail(glyphs[i].text)
    const next = after <= to ? type(after) : NONE
    const joinsAfter =
      own === DUAL && end !== ZWNJ && (end === ZWJ || next === DUAL || next === RIGHT || next === CAUSING)
    const shapes = forms.get(glyphs[i].text.codePointAt(0)!)!
    const form =
      (joinsBefore && joinsAfter ? shapes[3] : 0) ||
      (joinsBefore ? shapes[1] : 0) ||
      (joinsAfter ? shapes[2] : 0) ||
      shapes[0]
    const drawn = shaped(glyphs[i].text, form)
    if (drawn !== glyphs[i].text) text.set(i, drawn)
  }
}

/**
 * The bidirectional types of a right-to-left part, resolved to the two levels it is drawn at:
 * 1 for right-to-left, 2 for left-to-right words and numbers inside it.
 */
function levels(glyphs: readonly Glyph[], from: number, to: number) {
  const count = to - from + 1
  const types = new Array<Kind>(count)
  for (let i = 0; i < count; i++) types[i] = kind(glyphs[from + i].text)
  // W1: a mark takes the type of what it is on.
  for (let i = 0; i < count; i++) if (types[i] === NSM) types[i] = i === 0 ? R : types[i - 1]
  // W2, W3, W7: a European number after an Arabic letter is an Arabic one, after a Latin letter a
  // Latin word; Arabic letters are right-to-left letters from here on.
  let strong: Kind = R
  for (let i = 0; i < count; i++) {
    const type = types[i]
    if (type === L || type === R || type === AL) strong = type
    else if (type === EN) types[i] = strong === AL ? AN : strong === L ? L : EN
  }
  for (let i = 0; i < count; i++) if (types[i] === AL) types[i] = R
  // W4: one separator between two digits of a kind belongs to the number.
  for (let i = 1; i < count - 1; i++) {
    const [before, type, after] = [types[i - 1], types[i], types[i + 1]]
    if (before === EN && after === EN && (type === ES || type === CS)) types[i] = EN
    else if (before === AN && after === AN && type === CS) types[i] = AN
  }
  // W5: terminators beside a European number belong to it.
  for (let i = 0; i < count; i++) {
    if (types[i] !== ET) continue
    let end = i
    while (end < count && types[end] === ET) end++
    const number = (i > 0 && types[i - 1] === EN) || (end < count && types[end] === EN)
    for (let j = i; j < end; j++) types[j] = number ? EN : ON
    i = end - 1
  }
  const direction = (type: Kind) => (type === L ? L : type === R || type === EN || type === AN ? R : undefined)
  // BD16, N0: brackets that pair up take one direction: right-to-left when there is right-to-left
  // text or a number inside, left-to-right when there is only left-to-right text inside, else that
  // of the text before them. So `foo(bar)` or `{"a":1}` stays one left-to-right run with its
  // brackets as written, and only brackets at the right-to-left level are mirrored.
  for (const [open, close] of pairs(glyphs, from, types)) {
    let inside: Kind | undefined
    for (let j = open + 1; j < close && inside !== R; j++) inside = direction(types[j]) ?? inside
    if (inside === undefined) {
      inside = R
      for (let j = open - 1; j >= 0; j--) {
        const before = direction(types[j])
        if (before === undefined) continue
        inside = before
        break
      }
    }
    types[open] = inside
    types[close] = inside
  }
  // W6, N1, N2: what is left takes the direction on both sides of it, or else the part's own.
  const level = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    const own = direction(types[i])
    if (own !== undefined) {
      level[i] = own === L || types[i] === EN || types[i] === AN ? 2 : 1
      continue
    }
    let end = i
    while (end < count && direction(types[end]) === undefined) end++
    const before = i > 0 ? direction(types[i - 1])! : R
    const after = end < count ? direction(types[end])! : R
    for (let j = i; j < end; j++) level[j] = before === L && after === L ? 2 : 1
    i = end - 1
  }
  return level
}

/**
 * A line laid out for a terminal that does no bidirectional layout itself, or nothing when it has
 * no right-to-left letter. `cursor` is the glyph a caret is before, if any.
 */
export function layout(glyphs: readonly Glyph[], cursor?: number): Layout | undefined {
  const count = glyphs.length
  let any = false
  const kinds = new Array<Kind>(count)
  for (let i = 0; i < count; i++) {
    kinds[i] = kind(glyphs[i].text)
    if (strongRtl(kinds[i])) any = true
  }
  if (!any) return undefined
  const order = Array.from({ length: count }, (_, i) => i)
  const text = new Map<number, string>()
  const place = new Map<number, number>()
  const levelOf = new Map<number, number>()
  let caret: number | undefined
  const parts: { from: number; to: number }[] = []

  // The line is cut at borders and at gaps of three spaces or more: separate panes and columns.
  let start = 0
  while (start < count) {
    if (border(glyphs[start].text)) {
      start++
      continue
    }
    let end = start
    let spaces = 0
    while (end < count && !border(glyphs[end].text)) {
      spaces = blank(glyphs[end].text) ? spaces + 1 : 0
      if (spaces === 3) {
        end -= 2
        break
      }
      end++
    }
    parts.push({ from: start, to: end - 1 })
    start = end
    while (start < count && blank(glyphs[start].text)) start++
  }

  for (const segment of parts) {
    let first = -1
    let last = -1
    let leading: Kind | undefined
    let content = -1
    for (let i = segment.from; i <= segment.to; i++) {
      const type = kinds[i]
      if (leading === undefined && (type === L || strongRtl(type))) leading = type
      if (strongRtl(type)) {
        if (first === -1) first = i
        last = i
      }
      if (!blank(glyphs[i].text)) content = i
    }
    if (first === -1) continue
    // A line that is right-to-left from its first letter is so to its end, punctuation and a closing
    // English word included, and so is an opening bracket or quote mark against its first word; what
    // stands apart before that, a quote marker or a bullet, keeps its place. In a left-to-right line
    // only the Persian words between them turn.
    const paragraph = leading !== L
    let from = first
    if (paragraph) while (from > segment.from && !blank(glyphs[from - 1].text) && neutral(kinds[from - 1])) from--
    let to = paragraph ? content : last
    // While typing, the spaces just typed after the words belong to them, though a field's empty
    // cells after them would make them a gap.
    if (paragraph && cursor !== undefined && cursor - 1 > to && cursor <= count) {
      let spaces = true
      for (let i = to + 1; i < cursor; i++) if (!blank(glyphs[i].text)) spaces = false
      if (spaces) to = cursor - 1
    }
    const level = levels(glyphs, from, to)
    // L2: the left-to-right runs keep their order, the part is turned around.
    const span: number[] = []
    for (let i = to; i >= from; i--) span.push(i)
    for (let i = 0; i < span.length; ) {
      if (level[span[i] - from] !== 2) {
        i++
        continue
      }
      let end = i
      while (end < span.length && level[span[end] - from] === 2) end++
      span.splice(i, end - i, ...span.slice(i, end).reverse())
      i = end
    }
    span.forEach((glyph, offset) => {
      order[from + offset] = glyph
      place.set(glyph, from + offset)
      levelOf.set(glyph, level[glyph - from])
    })
    for (let i = from; i <= to; i++) {
      if (level[i - from] !== 1) continue
      const cp = glyphs[i].text.codePointAt(0)!
      const mirror = mirrors.get(cp)
      if (mirror !== undefined) text.set(i, String.fromCodePoint(mirror) + glyphs[i].text.slice(1))
    }
    shape(glyphs, from, to, text)
    if (cursor !== undefined && cursor >= from && cursor <= to + 1) {
      if (cursor === from) caret = place.get(from)
      else {
        const before = cursor - 1
        caret = levelOf.get(before) === 1 ? place.get(before)! - 1 : place.get(before)! + 1
      }
    }
  }
  return { order, text, caret }
}

// What a line written to a terminal holds besides text: escape sequences, which stay where they are.
const escapes = /\x1b\[[0-9;:?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const anyRtl = /[\u0590-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]/

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const width = (text: string) => {
  const measure = globalThis.Bun?.stringWidth
  return measure ? measure(text) : text.length
}

/** A line as glyphs, an escape sequence being a glyph of no width. */
function tokens(line: string) {
  const result: (Glyph & { code: boolean })[] = []
  const codes = line.match(escapes) ?? []
  line.split(escapes).forEach((piece, index) => {
    for (const item of segmenter.segment(piece))
      result.push({ text: item.segment, width: width(item.segment), code: false })
    const code = codes[index]
    if (code !== undefined) result.push({ text: code, width: 0, code: true })
  })
  return result
}

/** Cuts a line into rows no wider than `columns`, after a space where there is one. */
function wrap(line: (Glyph & { code: boolean })[], columns: number) {
  const rows: (Glyph & { code: boolean })[][] = []
  let current: (Glyph & { code: boolean })[] = []
  let used = 0
  let space = -1
  for (const token of line) {
    if (used + token.width > columns && used > 0) {
      if (space >= 0 && !blank(token.text)) {
        rows.push(current.slice(0, space))
        current = current.slice(space + 1)
      } else {
        rows.push(current)
        current = []
      }
      used = current.reduce((sum, item) => sum + item.width, 0)
      space = -1
      if (blank(token.text)) continue
    }
    if (blank(token.text) && !token.code) space = current.length
    current.push(token)
    used += token.width
  }
  rows.push(current)
  return rows
}

/** One row laid out, each stretch between escape sequences on its own. */
function row(tokens: (Glyph & { code: boolean })[]) {
  let output = ""
  let piece: Glyph[] = []
  const flush = () => {
    const result = layout(piece)
    output += result
      ? result.order.map((index) => result.text.get(index) ?? piece[index].text).join("")
      : piece.map((glyph) => glyph.text).join("")
    piece = []
  }
  for (const token of tokens) {
    if (!token.code) {
      piece.push(token)
      continue
    }
    flush()
    output += token.text
  }
  flush()
  return output
}

/**
 * Text as a terminal with no bidirectional layout should be given it: each line with right-to-left
 * letters cut into rows that fit `columns` (when given), each row laid out on its own, and what
 * escape sequences mark off laid out apart. Lines without such letters are left exactly as they are.
 */
export function text(value: string, columns?: number) {
  if (!anyRtl.test(value)) return value
  return value
    .split("\n")
    .map((line) => {
      if (!anyRtl.test(line)) return line
      const glyphs = tokens(line)
      const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0)
      const rows = columns && columns > 0 && total > columns ? wrap(glyphs, columns) : [glyphs]
      return rows.map(row).join("\n")
    })
    .join("\n")
}

export type Setting = "auto" | "on" | "off"

/**
 * What the terminal does with right-to-left text, from the variables it sets: `plain` draws it as
 * written (and is helped by this layout), `bidi` lays it out itself, `unknown` is anything else.
 * Inside tmux or screen the outer terminal's variables are what count, where they are passed on.
 */
export function terminal(env: Readonly<Record<string, string | undefined>>): "plain" | "bidi" | "unknown" {
  const program = env.TERM_PROGRAM
  if (program && ["vscode", "iTerm.app", "ghostty", "WezTerm", "WarpTerminal", "Hyper"].includes(program))
    return "plain"
  if (program === "Apple_Terminal") return "unknown"
  if (env.KONSOLE_VERSION || env.MLTERM) return "bidi"
  if (
    env.WT_SESSION ||
    env.KITTY_WINDOW_ID ||
    env.TERM?.startsWith("xterm-kitty") ||
    Object.keys(env).some((name) => name.startsWith("ALACRITTY_")) ||
    env.XTERM_VERSION ||
    env.VSCODE_INJECTION ||
    env.VSCODE_GIT_IPC_HANDLE ||
    env.LC_TERMINAL === "iTerm2" ||
    env.GHOSTTY_RESOURCES_DIR ||
    env.WEZTERM_PANE ||
    env.WARP_IS_LOCAL_SHELL_SESSION
  )
    return "plain"
  return "unknown"
}

/**
 * Whether to lay right-to-left text out: `HAMZAD_RTL=on|off` first, then the `rtl` setting, and with
 * `auto` only on a terminal known to draw such text as written.
 */
export function enabled(setting: Setting | undefined, env: Readonly<Record<string, string | undefined>>) {
  const forced = env.HAMZAD_RTL?.trim().toLowerCase()
  if (forced === "on" || forced === "1" || forced === "true") return true
  if (forced === "off" || forced === "0" || forced === "false") return false
  if (setting === "on") return true
  if (setting === "off") return false
  return terminal(env) === "plain"
}
