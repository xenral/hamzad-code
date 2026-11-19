import { HamzadBalance } from "@opencode/core/hamzad/balance"
import { Plugin } from "@opencode/plugin/tui"
import { Brand } from "@opencode/util/brand"
import { createSignal, Show } from "solid-js"

// How often the figure is asked for again while nothing else prompts it: credits also move when the
// person tops up in the panel or works in another window.
const EVERY = 60_000

// One interface per process, so the figure is kept here for the prompt's frame to read.
const [available, setAvailable] = createSignal<number>()

/** The credits left, as last heard; nothing while signed out or before the first answer. */
export const left = available

/**
 * The credits the account has left, beside what the session has spent: in the sidebar and on
 * the prompt's frame. To the hundredth, since a prompt on a small model costs less than a credit
 * and a whole number would stand still. Asked again whenever a request finishes, since that is
 * when the balance moves, once a minute besides, and whenever the server learns a new figure, as
 * it does when `/usage` opens. Hidden while signed out.
 */
export default Plugin.define({
  id: "hamzad.balance",
  setup(context) {
    if (!Brand.isHamzad) return
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
    const timer = setInterval(() => load(false), EVERY)
    const stop = [
      () => clearInterval(timer),
      rpc.events.on("changed", (event) => {
        turn.value++
        setAvailable(event.data.available)
      }),
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
            <text fg={context.theme.text.muted}>{Brand.money.exact(available() ?? 0)} left</text>
          </box>
        </Show>
      ),
    })

    return () => stop.forEach((off) => off())
  },
})
