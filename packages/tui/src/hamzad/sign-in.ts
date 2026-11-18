export * as HamzadSignIn from "./sign-in.js"

import type { IntegrationInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"

/**
 * Whether a prompt to this provider would go out with no sign-in. Hamzad's models are listed
 * before sign-in, so one can be selected while nobody is signed in; the prompt then opens the
 * sign-in dialog instead of being sent and refused.
 */
export function needed(providerID: string, integrations: readonly Pick<IntegrationInfo, "id" | "connections">[]) {
  return (
    Brand.isHamzad &&
    providerID === "hamzad" &&
    !integrations.some((integration) => integration.id === "hamzad" && integration.connections.length > 0)
  )
}
