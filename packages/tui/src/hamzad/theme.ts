export * as HamzadTheme from "./theme.js"

import { parseThemeDocument, type ThemeDocument } from "@opencode/theme/tui"
import { Brand } from "@opencode/util/brand"
import source from "./theme.json" with { type: "json" }

// Hamzad's colours, from the site's own tokens: a violet-black ground, violet for what is active,
// orchid and cyan beside it. The default in this build; a person's own `theme` setting still wins,
// and every other theme stays in the picker.

let parsed: ThemeDocument | undefined

/** The theme document, checked once. */
export function document() {
  parsed ??= parseThemeDocument(source, Brand.theme)
  return parsed
}

/** The themes this build adds to the built-in ones: none in upstream's. */
export const themes = (): Record<string, ThemeDocument> => (Brand.isHamzad ? { [Brand.theme]: document() } : {})

// Upstream's own themes are kept, under a name that is not upstream's.
const titles: Record<string, string> = {
  [Brand.theme]: Brand.name,
  opencode: "Classic",
  opencode2: "Classic (new designs)",
}

/** A theme as the picker names it. */
export const title = (name: string) => (Brand.isHamzad ? (titles[name] ?? name) : name)
