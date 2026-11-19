export * as HamzadNames from "./names.js"

import { Brand } from "@opencode/util/brand"
import { Locale } from "../util/locale"

// What a person reads for a name the program keeps as an id. Only the reading changes: configs,
// commands and the API go on using the ids.

/** An agent, as the prompt and a session's messages name it. */
export const agent = (id: string) => Brand.agents[id] ?? Locale.titlecase(id)

/** An agent in a list of them, where upstream shows the bare id. */
export const entry = (id: string) => (Brand.isHamzad ? agent(id) : id)

/** An agent's own name, unless this build names it otherwise. */
export const label = (id: string, name: string) => Brand.agents[id] ?? name
