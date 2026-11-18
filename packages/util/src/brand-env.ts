// Imported first by the CLI entry point, for its effect on `process.env`.
//
// The code reads `OPENCODE_*` variables everywhere; renaming them would touch hundreds of lines
// that upstream keeps changing. Instead every `HAMZAD_<NAME>` a person sets is copied to
// `OPENCODE_<NAME>` here, before anything reads the environment.

import { Brand } from "./brand.js"

// Hamzad's own settings, which have no upstream counterpart to alias.
const own = new Set([
  "HAMZAD_BRAND",
  "HAMZAD_API_URL",
  "HAMZAD_API_KEY",
  "HAMZAD_CLI_URL",
  "HAMZAD_ENV",
  "HAMZAD_UPSTREAM_PROVIDERS",
])

// A stock OpenCode setup may export these for its own files. Following them would put both tools
// on one config directory or one database, so they count only when given under Hamzad's name.
const locations = ["CONFIG_DIR", "CONFIG", "CONFIG_CONTENT", "DB"]

if (Brand.isHamzad) {
  // A parent Hamzad process has already done this and may pass a location to its child under the
  // upstream name, so only the outermost process drops what it inherited.
  if (process.env.HAMZAD_ENV !== "1")
    locations
      .filter((name) => process.env[`HAMZAD_${name}`] === undefined)
      .forEach((name) => delete process.env[`OPENCODE_${name}`])
  Object.entries(process.env)
    .filter((entry) => entry[0].startsWith("HAMZAD_") && !own.has(entry[0]) && entry[1] !== undefined)
    .forEach((entry) => {
      process.env[`OPENCODE_${entry[0].slice("HAMZAD_".length)}`] = entry[1]
    })
  process.env.HAMZAD_ENV = "1"
}
