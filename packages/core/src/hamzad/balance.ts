export * as HamzadBalance from "./balance.js"

import { Rpc } from "@opencode/schema/rpc"
import { Schema } from "effect"

const Count = Schema.Struct({ requests: Schema.Number, credits: Schema.Number })

/** What the account used through the gateway, as `/usage` shows it. Credits throughout. */
export const Usage = Schema.Struct({
  /** What can still be spent, to the hundredth. */
  available: Schema.Number,
  /** Used and not yet a line in the credit history. */
  pending: Schema.Number,
  today: Count,
  /** How many days `total` and `models` look back. */
  days: Schema.Number,
  total: Schema.Struct({
    requests: Schema.Number,
    credits: Schema.Number,
    promptTokens: Schema.Number,
    completionTokens: Schema.Number,
  }),
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      requests: Schema.Number,
      credits: Schema.Number,
      promptTokens: Schema.Number,
      completionTokens: Schema.Number,
    }),
  ),
})
export type Usage = typeof Usage.Type

const Ask = Schema.Struct({ fresh: Schema.optional(Schema.Boolean) })

/**
 * The account's credits and usage, as the interface asks the server for them. `null` while signed
 * out or when the gateway gives no answer. `fresh` skips the server's short memory of the last
 * answer, for right after a request was charged. `changed` says what is left whenever the server
 * learns a new figure, so every place that shows it moves together.
 */
export const Definition = Rpc.define({
  id: "hamzad.balance",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Ask),
      output: Schema.toStandardSchemaV1(Schema.NullOr(Schema.Struct({ available: Schema.Number }))),
    },
    usage: {
      input: Schema.toStandardSchemaV1(Ask),
      output: Schema.toStandardSchemaV1(Schema.NullOr(Usage)),
    },
  },
  events: {
    changed: { schema: Schema.toStandardSchemaV1(Schema.Struct({ available: Schema.Number })) },
  },
})
