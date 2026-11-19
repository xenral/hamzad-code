export * as HamzadUsageText from "./usage-text.js"

import type { HamzadBalance } from "@opencode/core/hamzad/balance"

// The words and figures of `/usage`, apart from how they are drawn.

const whole = new Intl.NumberFormat("en-US")
const hundredths = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A spent amount to the hundredth; something that did cost is never shown as nothing. */
export const spent = (credits: number) => (credits > 0 && credits < 0.005 ? "<0.01" : hundredths.format(credits))

export const requests = (count: number) => `${whole.format(count)} ${count === 1 ? "request" : "requests"}`

const columns = [
  { title: "Requests", width: 8, value: (model: Model) => whole.format(model.requests) },
  { title: "Credits", width: 10, value: (model: Model) => spent(model.credits) },
  { title: "Tokens in", width: 13, value: (model: Model) => whole.format(model.promptTokens) },
  { title: "Tokens out", width: 11, value: (model: Model) => whole.format(model.completionTokens) },
]
type Model = HamzadBalance.Usage["models"][number]

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)

/**
 * The table by model, as lines of one width: the heading, then a row for each model in the
 * gateway's order, which is the most spent first. `name` gives a model its listed name.
 */
export function table(models: readonly Model[], name: (id: string) => string, width: number) {
  const figures = columns.reduce((sum, column) => sum + column.width + 2, 0)
  const first = Math.max(8, width - figures)
  const line = (label: string, cells: string[]) =>
    fit(label, first) + cells.map((cell, index) => `  ${cell.padStart(columns[index].width)}`).join("")
  return {
    head: line(
      "Model",
      columns.map((column) => column.title),
    ),
    rows: models.map((model) =>
      line(
        name(model.id),
        columns.map((column) => column.value(model)),
      ),
    ),
  }
}
