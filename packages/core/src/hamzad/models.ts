export * as HamzadModels from "./models.js"

import { Money } from "@opencode/schema/money"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import type { HamzadGateway } from "./gateway.js"

export const providerID = Provider.ID.make("hamzad")

/** The gateway's list as models of the Hamzad provider. Prices are credits per million tokens. */
export function derive(remote: readonly HamzadGateway.Model[]) {
  return remote.map((item) => {
    const id = Model.ID.make(item.id)
    const released = item.released ? Date.parse(item.released) : 0
    const input = item.pricing?.input ?? 0
    return Model.Info.make({
      ...Model.Info.default(providerID, id),
      name: item.name ?? item.id,
      ...(item.family ? { family: Model.Family.make(item.family) } : {}),
      ...(item.cache_format ? { compatibility: { cacheFormat: item.cache_format } } : {}),
      capabilities: {
        tools: item.capabilities?.tools ?? true,
        input: item.capabilities?.images ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      variants: item.capabilities?.reasoning === false ? [] : variants(item.reasoning_efforts ?? []),
      time: { released: Number.isFinite(released) ? released : 0 },
      // The gateway reports each request's exact charge, so these only fill the model picker.
      // A cache price it leaves out is billed as plain input.
      cost: item.pricing
        ? [
            {
              input: price(input),
              output: price(item.pricing.output ?? 0),
              cache: {
                read: price(item.pricing.cache_read ?? input),
                write: price(item.pricing.cache_write ?? input),
              },
            },
          ]
        : [],
      limit: {
        context: limit(item.context_window, 200_000),
        output: limit(item.max_output_tokens, 32_000),
      },
    })
  })
}

/** The model the gateway marks for a new session, when it marks one. */
export const preferred = (remote: readonly HamzadGateway.Model[]) => remote.find((item) => item.default)?.id

/** The model the gateway marks for titles and other small requests, when it marks one. */
export const small = (remote: readonly HamzadGateway.Model[]) => remote.find((item) => item.small)?.id

function variants(efforts: readonly string[]): Model.Info["variants"] {
  return Array.from(new Set(efforts), (effort) => ({
    id: Model.VariantID.make(effort),
    settings: { reasoningEffort: effort },
  }))
}

function price(value: number) {
  return Money.USDPerMillionTokens.make(Number.isFinite(value) && value >= 0 ? value : 0)
}

function limit(value: number | null | undefined, fallback: number) {
  const parsed = value == null ? fallback : Math.trunc(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
