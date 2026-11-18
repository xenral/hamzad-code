export * as HamzadEnvironment from "./environment.js"

import { Brand } from "@opencode/util/brand"

/**
 * Whether an integration's key from the environment is used ahead of its stored sign-ins.
 * Upstream uses a stored sign-in first. For Hamzad a key given in the environment is the one
 * meant: CI on a machine that is also signed in, or a look at another account.
 */
export const first = (integrationID: string | undefined) => Brand.isHamzad && integrationID === "hamzad"
