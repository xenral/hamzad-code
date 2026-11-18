import { HamzadBalance } from "@opencode/core/hamzad/balance"
import { Plugin } from "@opencode/plugin/tui"
import { Brand } from "@opencode/util/brand"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"

// Below this width the line under the prompt has no room beside the context and cost figures.
const FOOTER_MIN_WIDTH = 100

/**
 * The credits the account has left, beside what the session has spent: in the sidebar, and under
 * the prompt on a wide terminal. Asked again whenever a request finishes, since that is when the
 * balance moves. Hidden while signed out.
 */
export default Plugin.define({
  id: "hamzad.balance",
  setup(context) {
    if (!Brand.isHamzad) return
    const [available, setAvailable] = createSignal<number>()
    const rpc = context.client.rpc(HamzadBalance.Definition)
    const turn = { value: 0 }
    const load = (fresh: boolean) => {
      const current = ++turn.value
      const directory = context.location?.directory
      void rpc.get({ fresh }, directory ? { location: { directory } } : undefined).then(
        (next) => {
          if (current === turn.value) setAvailable(next?.available)
        },
        () => undefined,
      )
    }
    load(false)
    const stop = [
      context.data.on("server.connected", () => load(false)),
      context.data.on("credential.switched", () => load(true)),
      context.data.on("session.execution.succeeded", () => load(true)),
      context.data.on("session.execution.failed", () => load(true)),
      context.data.on("session.execution.interrupted", () => load(true)),
    ]

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={available() !== undefined}>
          <box>
            <text fg={context.theme.text.base}>
              <b>Credits</b>
            </text>
            <text fg={context.theme.text.muted}>{Brand.money.format(available() ?? 0)} left</text>
          </box>
        </Show>
      ),
    })

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const dimensions = useTerminalDimensions()
        return (
          <Show when={available() !== undefined && dimensions().width >= FOOTER_MIN_WIDTH}>
            <text fg={context.theme.text.muted} wrapMode="none" flexShrink={0}>
              {Brand.money.format(available() ?? 0)} left
            </text>
          </Show>
        )
      },
    })

    return () => stop.forEach((off) => off())
  },
})
