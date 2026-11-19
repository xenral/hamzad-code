import { Plugin } from "@opencode/plugin/tui"
import { Brand } from "@opencode/util/brand"
import { HamzadStatus } from "@opencode/util/hamzad-status"
import { createMemo, createSignal, Show } from "solid-js"

/**
 * Under the prompt, one line saying why Hamzad lists no models: its API is not open yet, a sign-in
 * is wanted, this account has no access, or it cannot be reached. An empty model list with no word
 * about it reads as a broken program. Nothing is shown once the models are there.
 */
// One interface per process, so the state the plugin learns is kept here for the prompt to read.
const [state, setState] = createSignal<HamzadStatus.State>()

/**
 * The model and provider words for a prompt with no model, from what Hamzad's API last said, or
 * nothing before it has said anything and in upstream's build.
 */
export function empty() {
  if (!Brand.isHamzad) return undefined
  const current = state()
  return { ...HamzadStatus.labels(current ?? "sign-in"), reasoning: false }
}

export default Plugin.define({
  id: "hamzad.status",
  setup(context) {
    if (!Brand.isHamzad) return
    const rpc = context.client.rpc(HamzadStatus.definition)
    const load = () => {
      const directory = context.location?.directory
      void rpc.get({}, directory ? { location: { directory } } : undefined).then(
        (answer) => setState(HamzadStatus.read(answer)),
        () => undefined,
      )
    }
    load()
    const stop = [
      context.data.on("server.connected", load),
      context.data.on("credential.switched", load),
      rpc.events.on("changed", (event) => void setState(HamzadStatus.read(event.data))),
    ]
    const line = createMemo(() => {
      const current = state()
      if (!current) return undefined
      const listed = (context.data.location.model.list(context.location) ?? []).some(
        (model) => model.providerID === "hamzad",
      )
      return listed ? undefined : HamzadStatus.reason(current)
    })

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => (
        <Show when={line()}>
          {(text) => (
            <text fg={context.theme.text.feedback.warning.base} wrapMode="none" flexShrink={0}>
              {text()}
            </text>
          )}
        </Show>
      ),
    })

    return () => stop.forEach((off) => off())
  },
})
