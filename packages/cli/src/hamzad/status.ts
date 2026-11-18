export * as HamzadModelList from "./status"

// What the command line says when Hamzad lists no models. The server knows why: the gateway is
// switched off, wants a sign-in, is not open to this account, or is out of reach.

import type { OpenCodeClient } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { HamzadStatus } from "@opencode/util/hamzad-status"
import { Effect } from "effect"
import { EOL } from "node:os"
import { waitForPlugins } from "../services/plugin-startup"

const state = (client: OpenCodeClient, directory: string) =>
  client
    .rpc(HamzadStatus.definition)
    .get({}, { location: { directory } })
    .then(HamzadStatus.read, () => undefined)

/**
 * One line, on stderr, for a list that holds none of Hamzad's models: why it is empty. Nothing is
 * said when the models are there, or when the server cannot tell.
 */
export const explain = Effect.fn("cli.hamzad.models.explain")(function* (
  client: OpenCodeClient,
  directory: string,
  models: readonly string[],
) {
  if (!Brand.isHamzad || models.some((model) => model.startsWith("hamzad/"))) return
  const current = yield* Effect.promise(() => state(client, directory))
  const line = current && HamzadStatus.reason(current)
  if (line) process.stderr.write(line + EOL)
})

/**
 * Why a prompt has no model to go to, when the reason is Hamzad's: asked for by name and not
 * listed, or nothing listed at all. Without this the prompt is sent anyway and ends in a line
 * about a session having no model, which says nothing a person can act on. `undefined` when some
 * model can take the prompt.
 */
export async function missing(client: OpenCodeClient, directory: string, provider: string | undefined) {
  if (!Brand.isHamzad || (provider !== undefined && provider !== "hamzad")) return undefined
  await Effect.runPromise(waitForPlugins(client, directory))
  const listed = await client.model.list({ location: { directory } }).then(
    (response) => response.data,
    () => undefined,
  )
  if (!listed || listed.some((model) => (provider ? model.providerID === provider : true))) return undefined
  const current = await state(client, directory)
  return current && HamzadStatus.prompt(current)
}
