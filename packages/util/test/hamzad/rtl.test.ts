import { describe, expect, test } from "bun:test"
import { HamzadRtl } from "../../src/hamzad-rtl.js"

// The letters a terminal is given, written out: a presentation form is hard to tell from its letter.
const cp = (...codes: number[]) => String.fromCodePoint(...codes)
const glyphs = (text: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (item) => ({
    text: item.segment,
    width: Bun.stringWidth(item.segment),
  }))
/** A one-word line's letters in reading order, each in the form it is drawn in. */
const forms = (word: string) => [...HamzadRtl.text(word)].reverse().map((char) => char.codePointAt(0))

describe("letters take the form they have beside their neighbours", () => {
  test("every presentation form in the table is its letter", () => {
    for (const [base, shapes] of HamzadRtl.presentation)
      for (const form of shapes) if (form) expect(cp(form).normalize("NFKD")).toBe(cp(base).normalize("NFKD"))
  })

  test("Persian's own letters and Arabic's kaf and yeh: alone, first, in the middle, last", () => {
    // isolated, final, initial, medial, as Unicode lists them
    const letters: [string, number[]][] = [
      ["پ", [0xfb56, 0xfb57, 0xfb58, 0xfb59]],
      ["چ", [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d]],
      ["گ", [0xfb92, 0xfb93, 0xfb94, 0xfb95]],
      ["ک", [0xfb8e, 0xfb8f, 0xfb90, 0xfb91]],
      ["ی", [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff]],
      ["ك", [0xfed9, 0xfeda, 0xfedb, 0xfedc]],
      ["ي", [0xfef1, 0xfef2, 0xfef3, 0xfef4]],
      ["ى", [0xfeef, 0xfef0, 0xfbe8, 0xfbe9]],
    ]
    for (const [letter, [isolated, final, initial, medial]] of letters) {
      expect(forms(letter)).toEqual([isolated])
      expect(forms(letter + letter + letter)).toEqual([initial, medial, final])
    }
  })

  test("a letter that joins only to the one before it ends the join", () => {
    // ژ: alone, and after ب
    expect(forms("ژ")).toEqual([0xfb8a])
    expect(forms("بژب")).toEqual([0xfe91, 0xfb8b, 0xfe8f])
    for (const [letter, isolated, final] of [
      ["ا", 0xfe8d, 0xfe8e],
      ["آ", 0xfe81, 0xfe82],
      ["أ", 0xfe83, 0xfe84],
      ["إ", 0xfe87, 0xfe88],
      ["د", 0xfea9, 0xfeaa],
      ["ذ", 0xfeab, 0xfeac],
      ["ر", 0xfead, 0xfeae],
      ["ز", 0xfeaf, 0xfeb0],
      ["و", 0xfeed, 0xfeee],
      ["ؤ", 0xfe85, 0xfe86],
      ["ة", 0xfe93, 0xfe94],
    ] as const) {
      expect(forms(letter)).toEqual([isolated])
      expect(forms("ب" + letter + "ب")).toEqual([0xfe91, final, 0xfe8f])
    }
  })

  test("hamza joins nothing", () => {
    // شیء: the yeh before it is final, not medial; hamza is the same alone, so it is left as it is
    expect(forms("شیء")).toEqual([0xfeb7, 0xfbfd, 0x621])
  })

  test("a sentence with ZWNJ: the letter before it ends its word, the one after it begins one", () => {
    // می‌خواند: meem initial, yeh final; khah initial, waw final, alef alone, noon initial, dal final
    expect(forms("می‌خواند")).toEqual([0xfee3, 0xfbfd, 0xfea7, 0xfeee, 0xfe8d, 0xfee7, 0xfeaa])
    // می‌روم and جمله‌ی as a terminal is given them: right to left, the ZWNJ done with
    expect(HamzadRtl.text("می‌روم")).toBe(cp(0xfee1, 0xfeed, 0xfead, 0xfbfd, 0xfee3))
    expect(HamzadRtl.text("جمله‌ی")).toBe(cp(0xfbfc, 0xfeea, 0xfee0, 0xfee4, 0xfe9f))
  })

  test("harakat stay on their letters and do not break the join", () => {
    // کَتَبَ: kaf initial, teh medial, beh final, each with its fatha
    expect(HamzadRtl.text("کَتَبَ")).toBe(cp(0xfe90, 0x64e, 0xfe98, 0x64e, 0xfb90, 0x64e))
    // مُحَمَّد: fatha and shadda on one letter
    expect(HamzadRtl.text("مُحَمَّد")).toBe(cp(0xfeaa, 0xfee4, 0x64e, 0x651, 0xfea4, 0x64e, 0xfee3, 0x64f))
  })

  test("tatweel and ZWJ join, and no lam-alef ligature takes away a cell", () => {
    expect(HamzadRtl.text("بـ")).toBe(cp(0x640, 0xfe91))
    expect(HamzadRtl.text("ب\u200d")).toBe(cp(0xfe91))
    // لا stays two letters in two cells
    expect(HamzadRtl.text("لا")).toBe(cp(0xfe8e, 0xfedf))
  })

  test("characters with no presentation form are left as they are, and do not join", () => {
    // U+06D5 (ae) has none; the beh before it is drawn alone
    expect(HamzadRtl.text("بە")).toBe(cp(0x6d5, 0xfe8f))
  })
})

describe("a line reads right to left", () => {
  test("Persian digits and an English word inside a Persian sentence keep their own order", () => {
    expect(HamzadRtl.text("عدد ۱۲۳ است")).toBe("ﺖﺳﺍ ۱۲۳ ﺩﺪﻋ")
    expect(HamzadRtl.text("نسخه Python 3.12 است")).toBe("ﺖﺳﺍ Python 3.12 ﻪﺨﺴﻧ")
    expect(HamzadRtl.text("متن ساده با عدد ۱۲۳ و کلمه‌ی English در وسط.")).toBe(
      ".ﻂﺳﻭ ﺭﺩ English ﯼﻪﻤﻠﮐ ﻭ ۱۲۳ ﺩﺪﻋ ﺎﺑ ﻩﺩﺎﺳ ﻦﺘﻣ",
    )
    // a decimal and a thousands separator stay inside their numbers
    expect(HamzadRtl.text("قیمت ۱٬۲۵۰ و ۳٫۵ است")).toBe("ﺖﺳﺍ ۳٫۵ ﻭ ۱٬۲۵۰ ﺖﻤﯿﻗ")
  })

  test("Persian punctuation ، ؛ ؟ goes with the sentence, a full stop to its end on the left", () => {
    expect(HamzadRtl.text("سلام، خوبی؟")).toBe(cp(0x61f, 0xfbfd, 0xfe91, 0xfeee, 0xfea7) + " ،" + "ﻡﺎﻠﺳ")
    expect(HamzadRtl.text("بله؛ نه.")).toBe(".ﻪﻧ ؛ﻪﻠﺑ")
  })

  test("brackets are mirrored inside right-to-left text", () => {
    expect(HamzadRtl.text("(سلام)")).toBe("(ﻡﺎﻠﺳ)")
    expect(HamzadRtl.text("«سلام»")).toBe("«ﻡﺎﻠﺳ»")
    expect(HamzadRtl.text("سلام (hello) دنیا")).toBe("ﺎﯿﻧﺩ (hello) ﻡﺎﻠﺳ")
    expect(HamzadRtl.text("آیا نصب است؟ [بله]")).toBe("[ﻪﻠﺑ] ؟ﺖﺳﺍ ﺐﺼﻧ ﺎﯾﺁ")
  })

  test("code inside a Persian sentence stays one left-to-right run, its brackets as written", () => {
    expect(HamzadRtl.text("این تابع foo(bar) رو درست کن")).toBe("ﻦﮐ ﺖﺳﺭﺩ ﻭﺭ foo(bar) ﻊﺑﺎﺗ ﻦﯾﺍ")
    expect(HamzadRtl.text("فایل src/app.ts رو باز کن")).toBe("ﻦﮐ ﺯﺎﺑ ﻭﺭ src/app.ts ﻞﯾﺎﻓ")
    expect(HamzadRtl.text('از {"a":1} استفاده کن')).toBe('ﻦﮐ ﻩﺩﺎﻔﺘﺳﺍ {"a":1} ﺯﺍ')
    expect(HamzadRtl.text("تابع foo() را صدا بزن")).toBe("ﻥﺰﺑ ﺍﺪﺻ ﺍﺭ foo() ﻊﺑﺎﺗ")
    expect(HamzadRtl.text('این را اجرا کن [[tool:bash {"command":"sh fa.sh","description":"Persian"}]]')).toBe(
      '[[tool:bash {"command":"sh fa.sh","description":"Persian"}]] ﻦﮐ ﺍﺮﺟﺍ ﺍﺭ ﻦﯾﺍ',
    )
  })

  test("a Persian aside in brackets is mirrored with the sentence around it", () => {
    expect(HamzadRtl.text("همزاد (دستیار کد) کمک می‌کند.")).toBe(".ﺪﻨﮐﯽﻣ ﮏﻤﮐ (ﺪﮐ ﺭﺎﯿﺘﺳﺩ) ﺩﺍﺰﻤﻫ")
    // a bracket left without its pair is mirrored where it stands
    expect(HamzadRtl.text("سلام (دنیا")).toBe("ﺎﯿﻧﺩ) ﻡﺎﻠﺳ")
  })

  test("a quote marker before Persian stays where it is", () => {
    expect(HamzadRtl.text("> همزاد کنار کدت می‌نشیند.")).toBe("> .ﺪﻨﯿﺸﻧﯽﻣ ﺕﺪﮐ ﺭﺎﻨﮐ ﺩﺍﺰﻤﻫ")
  })

  test("in an English line only the Persian words turn, in place", () => {
    expect(HamzadRtl.text("The tool returned: سلام دنیا.")).toBe("The tool returned: ﺎﯿﻧﺩ ﻡﺎﻠﺳ.")
  })

  test("borders and gaps between panes are kept, and each pane is laid out on its own", () => {
    expect(HamzadRtl.text("│ سلام دنیا │")).toBe("│ ﺎﯿﻧﺩ ﻡﺎﻠﺳ │")
    expect(HamzadRtl.text("┃  سلام   left پنل   ┃ right")).toBe("┃  ﻡﺎﻠﺳ   left ﻞﻨﭘ   ┃ right")
    expect(HamzadRtl.text("سلام دنیا    English pane")).toBe("ﺎﯿﻧﺩ ﻡﺎﻠﺳ    English pane")
  })

  test("a line with no right-to-left letter is not touched", () => {
    for (const line of ["all English here (1, 2, 3)", "┃  Build · Claude Sonnet ┃", "", "你好 world"]) {
      expect(HamzadRtl.text(line)).toBe(line)
      expect(HamzadRtl.layout(glyphs(line))).toBeUndefined()
    }
  })

  test("Hebrew", () => {
    expect(HamzadRtl.text("שלום עולם 123")).toBe("123 םלוע םולש")
    expect(HamzadRtl.text("hello שלום world")).toBe("hello םולש world")
  })

  test("a wide glyph moves whole", () => {
    const line = glyphs("کَتَبَ 你好 שלום")
    const result = HamzadRtl.layout(line)!
    expect(result.order.map((index) => line[index].text).join("")).toBe("םולש 你好 بَتَکَ")
  })
})

describe("the caret goes where the next letter appears", () => {
  const caret = (text: string, cursor: number) => {
    const line = glyphs(text)
    const result = HamzadRtl.layout(line, cursor)
    return result?.caret
  }

  test("after the last Persian letter it is just left of the words", () => {
    expect(caret("سلام", 4)).toBe(-1)
    expect(caret("ab سلام", 7)).toBe(2)
  })

  test("spaces just typed after the words go with them", () => {
    const line = glyphs("سلام ")
    const result = HamzadRtl.layout(line, 5)!
    expect(result.order).toEqual([4, 3, 2, 1, 0])
    expect(result.caret).toBe(-1)
  })

  test("inside a word it is on the letter that follows in reading order", () => {
    // between lam and alef: on the alef, drawn second from the left
    expect(caret("سلام", 2)).toBe(1)
    // at the start: on the first letter, drawn rightmost
    expect(caret("سلام", 0)).toBe(3)
  })

  test("after an English word inside Persian it is right of that word", () => {
    expect(caret("سلام abc", 8)).toBe(3)
  })

  test("outside right-to-left text it does not move", () => {
    expect(caret("abc سلام def", 1)).toBeUndefined()
  })
})

describe("text written to a terminal", () => {
  test("escape sequences stay, and the text between them is laid out", () => {
    expect(HamzadRtl.text("\x1b[1mسلام\x1b[0m done")).toBe("\x1b[1mﻡﺎﻠﺳ\x1b[0m done")
  })

  test("a long line is cut into rows that fit, each read right to left", () => {
    const rows = HamzadRtl.text("این یک جمله‌ی بلند است که باید شکسته شود.", 20).split("\n")
    expect(rows).toEqual(["ﺪﻨﻠﺑ ﯼﻪﻠﻤﺟ ﮏﯾ ﻦﯾﺍ", "ﻪﺘﺴﮑﺷ ﺪﯾﺎﺑ ﻪﮐ ﺖﺳﺍ", ".ﺩﻮﺷ"])
    for (const row of rows) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(20)
  })

  test("lines without right-to-left letters are not cut or changed", () => {
    const line = "word ".repeat(30)
    expect(HamzadRtl.text(line, 20)).toBe(line)
  })
})

describe("when the layout is on", () => {
  test("auto: on in terminals that draw text as written, off in those that lay it out and in unknown ones", () => {
    expect(HamzadRtl.enabled("auto", { TERM_PROGRAM: "vscode" })).toBe(true)
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "iTerm.app" })).toBe(true)
    for (const env of [
      { TERM_PROGRAM: "ghostty" },
      { TERM_PROGRAM: "WezTerm" },
      { TERM_PROGRAM: "WarpTerminal" },
      { TERM_PROGRAM: "Hyper" },
      { WT_SESSION: "1" },
      { TERM: "xterm-kitty" },
      { KITTY_WINDOW_ID: "1" },
      { ALACRITTY_WINDOW_ID: "1" },
      { XTERM_VERSION: "XTerm(390)" },
    ])
      expect(HamzadRtl.enabled(undefined, env)).toBe(true)
    expect(HamzadRtl.enabled(undefined, { KONSOLE_VERSION: "230805" })).toBe(false)
    expect(HamzadRtl.enabled(undefined, { MLTERM: "3.9" })).toBe(false)
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "Apple_Terminal" })).toBe(false)
    expect(HamzadRtl.enabled(undefined, { TERM: "xterm-256color" })).toBe(false)
  })

  test("inside tmux the outer terminal's own variables count", () => {
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "tmux", TMUX: "/tmp/x", VSCODE_INJECTION: "1" })).toBe(true)
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "tmux", TMUX: "/tmp/x", KONSOLE_VERSION: "1" })).toBe(false)
    expect(HamzadRtl.enabled(undefined, { TERM: "screen-256color", WT_SESSION: "1" })).toBe(true)
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "tmux", TMUX: "/tmp/x" })).toBe(false)
  })

  test("the setting decides over auto, and HAMZAD_RTL over the setting", () => {
    expect(HamzadRtl.enabled("on", { TERM_PROGRAM: "Apple_Terminal" })).toBe(true)
    expect(HamzadRtl.enabled("off", { TERM_PROGRAM: "vscode" })).toBe(false)
    expect(HamzadRtl.enabled("off", { TERM_PROGRAM: "vscode", HAMZAD_RTL: "on" })).toBe(true)
    expect(HamzadRtl.enabled("on", { HAMZAD_RTL: "off" })).toBe(false)
    expect(HamzadRtl.enabled(undefined, { TERM_PROGRAM: "vscode", HAMZAD_RTL: "OFF" })).toBe(false)
  })
})

describe("a laid-out line for a terminal that may hand its text to a browser", () => {
  const mark = "‎"
  test("has a left-to-right mark after each right-to-left letter, with the marks it carries", () => {
    const shown = HamzadRtl.text("سلام، لطفاً ۱۲")
    const marked = HamzadRtl.marked(shown)
    expect(marked.replaceAll(mark, "")).toBe(shown)
    // every right-to-left letter is followed by a mark, and no vowel mark is parted from its letter
    expect(marked).not.toMatch(/[ﭐ-﻿](?!\p{M}*‎)/u)
    expect(marked).not.toMatch(/‎\p{M}/u)
    expect(marked).toContain(`${cp(0xfe8e, 0x64b)}${mark}`)
  })

  test("leaves other text and escape sequences as they are", () => {
    expect(HamzadRtl.marked("plain English 42")).toBe("plain English 42")
    const link = "\x1b]8;;https://hamzad.ai/سلام\x1b\\"
    expect(HamzadRtl.marked(`${link}ﻡ\x1b[0m`)).toBe(`${link}ﻡ${mark}\x1b[0m`)
  })
})
