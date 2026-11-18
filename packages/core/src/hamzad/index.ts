export * as HamzadPlugins from "./index.js"

import { Brand } from "@opencode/util/brand"
import type { PluginInternal } from "../plugin/internal.js"
import { HamzadIdentity } from "./identity.js"
import { HamzadPlugin } from "./plugin.js"

// Hosts on the person's own machine stay; they need no account and reach no outside service.
const local = new Set(["opencode.provider.ollama", "opencode.provider.lmstudio", "opencode.provider.vllm"])

/** Upstream's hosted service and other vendors' sign-ins come back with this set. */
export const upstreamProviders = () =>
  ["1", "true"].includes(process.env.HAMZAD_UPSTREAM_PROVIDERS?.toLowerCase() ?? "")

/**
 * The built-in plugins this build runs: upstream's, without the plugins of other hosted providers,
 * and Hamzad's own after them, so they see what upstream registered and run before the person's config.
 */
export function arrange(plugins: readonly PluginInternal.InternalPlugin[]): readonly PluginInternal.InternalPlugin[] {
  if (!Brand.isHamzad) return plugins
  return [
    ...(upstreamProviders()
      ? plugins
      : plugins.filter((plugin) => !plugin.id.startsWith("opencode.provider.") || local.has(plugin.id))),
    HamzadPlugin.Plugin,
    HamzadIdentity.Plugin,
  ]
}
