export * as HamzadBalance from "./balance.js"

import { Rpc } from "@opencode/schema/rpc"
import { Schema } from "effect"

/**
 * The credits the signed-in account can still spend, as the interface asks the server for them.
 * `null` while signed out or when the gateway cannot be reached. `fresh` skips the server's short
 * memory of the last answer, for right after a request was charged.
 */
export const Definition = Rpc.define({
  id: "hamzad.balance",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ fresh: Schema.optional(Schema.Boolean) })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(Schema.Struct({ available: Schema.Number }))),
    },
  },
  events: {},
})
