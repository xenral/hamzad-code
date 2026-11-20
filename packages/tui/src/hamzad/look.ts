export * as HamzadLook from "./look.js"

import { Brand } from "@opencode/util/brand"

// Hamzad's layout: the conversation open across the whole window, a person's words and Hamzad's
// marked `you ›` and `hamzad ›`, every tool step one line set in under them, a line of space
// between them, and the prompt in a rounded frame with room above and below what is typed.
// Upstream's screens switch to it at a few points; these helpers keep each of those points to the
// value it changes.

/** Whether this build draws Hamzad's layout. Upstream's build keeps upstream's look. */
export const own = Brand.isHamzad

/** Below this many columns the prompt's frame keeps its top and bottom edges and drops its sides. */
export const NARROW = 60

/** How far tool steps are set in from the speakers, so a turn reads as words, then what was done. */
export const STEP_INDENT = 2

/** Upstream's padding, or none: a speaker's name marks where the words start. */
export const pad = (value: number) => (own ? 0 : value)

/** Upstream's padding before a tool step's line, or Hamzad's own indent. */
export const indent = (value: number) => (own ? STEP_INDENT : value)

/** Upstream's fill, or none: the terminal's own background shows through. */
export const flat = <Value>(value: Value) => (own ? undefined : value)

/** Whether runs of reads and searches fold into one line by default: not when each step has its own. */
export const grouping = own ? ("none" as const) : undefined

type Row = { readonly type: string; readonly ref?: { readonly partID: string }; readonly kind?: string }

// A tool step's row, or a group of them; text and reasoning parts are named `text:<n>` and `reasoning:<n>`.
const step = (row: Row | undefined) =>
  row !== undefined &&
  ((row.type === "part" && !/^(?:text|reasoning):/.test(row.ref?.partID ?? "")) ||
    (row.type === "group" && (row.kind === "exploration" || row.kind === "activity")))

/** The space above a transcript row: none between two tool steps, so a run of them reads as one list. */
export const gap = (row: Row, previous?: Row) => (own && step(row) && step(previous) ? 0 : 1)
