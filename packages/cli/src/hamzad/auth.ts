export * as HamzadAuth from "./auth"

// What `auth login`, `auth logout` and `auth list` do differently in this build: with no
// argument they mean Hamzad, and a sign-in needs no choosing.

import type { IntegrationInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { Effect } from "effect"
import { requireInteractive } from "../ui/prompt"

/** The integration a bare `auth login` or `auth logout` is about. Upstream asks which one. */
export const integration = Brand.isHamzad ? "hamzad" : undefined

/** The integration to act on: the one named, else Hamzad. */
export const target = (given: string | undefined) => given ?? integration

/**
 * How to sign in: the way named, else for Hamzad the approval in the panel, so `auth login` goes
 * straight to the code and the link. A key is pasted with `--method key`.
 */
export const method = (integrationID: string, given: string | undefined) =>
  given ?? (integrationID === integration ? "device" : undefined)

/**
 * The stored Hamzad sign-in to remove when none was named: the only one there is. With several, a
 * person has to pick, which needs a terminal; with none, the caller says so.
 */
export const only = Effect.fn("cli.hamzad.auth.only")(function* (info: IntegrationInfo) {
  const stored = info.connections.filter((connection) => connection.type === "credential")
  if (info.id === integration && stored.length === 1) return stored[0].id
  if (info.id !== integration || stored.length > 1)
    yield* requireInteractive("Pass a credential ID or label when running without an interactive terminal")
  return undefined
})

/**
 * What marks the sign-in in use where an integration has several. For Hamzad the first is the
 * key from the environment whenever one is set, ahead of whatever is stored.
 */
export const inUse = (info: IntegrationInfo, index: number) =>
  Brand.isHamzad && index === 0 && info.connections.length > 1 ? ", in use" : ""
