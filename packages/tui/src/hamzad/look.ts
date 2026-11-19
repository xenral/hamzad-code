export * as HamzadLook from "./look.js"

import { Brand } from "@opencode/util/brand"

// The Framed layout: the conversation and the prompt each in one rounded frame, a person's words
// and Hamzad's marked `you ›` and `hamzad ›`, every tool step one line. Upstream's screens switch to
// it at a few points; these helpers keep each of those points to the value it changes.

/** Whether this build draws the Framed layout. Upstream's build keeps upstream's look. */
export const framed = Brand.isHamzad

/** Below this many columns a frame keeps its top and bottom edges and drops its sides. */
export const NARROW = 60

/** Upstream's padding, or none inside a frame. */
export const pad = (value: number) => (framed ? 0 : value)

/** Upstream's fill, or none: the frame is the only surface. */
export const flat = <Value>(value: Value) => (framed ? undefined : value)

/** Whether runs of reads and searches fold into one line by default: not when each step has its own. */
export const grouping = framed ? ("none" as const) : undefined

type Row = { readonly type: string; readonly ref?: { readonly partID: string }; readonly kind?: string }

// A tool step's row, or a group of them; text and reasoning parts are named `text:<n>` and `reasoning:<n>`.
const step = (row: Row | undefined) =>
  row !== undefined &&
  ((row.type === "part" && !/^(?:text|reasoning):/.test(row.ref?.partID ?? "")) ||
    (row.type === "group" && (row.kind === "exploration" || row.kind === "activity")))

/** The space above a transcript row: none between two tool steps, so a run of them reads as one list. */
export const gap = (row: Row, previous?: Row) => (framed && step(row) && step(previous) ? 0 : 1)
