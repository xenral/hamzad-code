// Loaded before anything else when the CLI runs from source or under test (the `preload` of the
// packages' bunfig.toml), so the sources read with the product's name rewritten exactly as they
// are in a built binary. Does nothing under `HAMZAD_BRAND=upstream`.

import { plugin } from "bun"
import { Brand } from "../../packages/util/src/brand"
import { brandPlugin } from "./brand-transform"

if (Brand.isHamzad) {
  // The interface's JSX plugin belongs to the package being run; one with no interface has none.
  const solid = await Promise.resolve()
    .then(() => import(Bun.resolveSync("@opentui/solid/bun-plugin", process.cwd())))
    .then(
      (module: { createSolidTransformPlugin: () => import("bun").BunPlugin }) => module.createSolidTransformPlugin(),
      () => undefined,
    )
  plugin(brandPlugin({ solid, always: true }))
}
