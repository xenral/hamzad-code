export * as HamzadModelList from "./status"

import type { OpenCodeClient } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { HamzadStatus } from "@opencode/util/hamzad-status"
import { Effect } from "effect"
import { EOL } from "node:os"

/**
 * One line, on stderr, for a list that holds none of Hamzad's models: why it is empty. The
 * server knows whether the gateway is switched off, wants a sign-in or is out of reach. Nothing is
 * said when the models are there, or when the server cannot tell.
 */
export const explain = Effect.fn("cli.hamzad.models.explain")(function* (
  client: OpenCodeClient,
  directory: string,
  models: readonly string[],
) {
  if (!Brand.isHamzad || models.some((model) => model.startsWith("hamzad/"))) return
  const answer = yield* Effect.promise(() =>
    client
      .rpc(HamzadStatus.definition)
      .get({}, { location: { directory } })
      .catch(() => undefined),
  )
  const state = HamzadStatus.read(answer)
  const line = state && HamzadStatus.reason(state)
  if (line) process.stderr.write(line + EOL)
})
