import { HamzadBalance } from "@opencode/core/hamzad/balance"
import { Brand } from "@opencode/util/brand"
import { HamzadStatus } from "@opencode/util/hamzad-status"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogHeader, DialogLayout, dialogWidth, useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import { HamzadUsageText } from "./usage-text"

/**
 * `/usage`: the credits the account has left, what it used through Hamzad's API today and over the
 * last month, and which models that went to. Asked of the gateway anew each time it opens, which
 * also moves the figure under the prompt and in the sidebar.
 */
export function DialogHamzadUsage() {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  // Undefined while the answer is on its way; null when there is none to show.
  const [usage, setUsage] = createSignal<HamzadBalance.Usage | null>()
  const [state, setState] = createSignal<HamzadStatus.State>("listed")
  // The dialog is as wide as the terminal lets it be, and the table is drawn to fit inside it.
  const dimensions = useTerminalDimensions()
  const width = () => Math.min(dialogWidth("large"), dimensions().width - 2) - DIALOG_INSET * 2

  onMount(() => {
    dialog.setSize("large")
    const directory = location.current?.directory
    const options = directory ? { location: { directory } } : undefined
    void client.api
      .rpc(HamzadStatus.definition)
      .get({}, options)
      .then(
        (answer) => setState(HamzadStatus.read(answer) ?? "listed"),
        () => undefined,
      )
    void client.api
      .rpc(HamzadBalance.Definition)
      .usage({ fresh: true }, options)
      .then(
        (answer) => setUsage(answer),
        () => setUsage(null),
      )
  })

  const signedIn = () =>
    (data.location.integration.list() ?? []).some(
      (integration) => integration.id === "hamzad" && integration.connections.length > 0,
    )
  const name = (id: string) =>
    (data.location.model.list(location.current) ?? []).find((model) => model.providerID === "hamzad" && model.id === id)
      ?.name ?? id

  return (
    <DialogLayout header={<DialogHeader title="Usage" />}>
      <Switch>
        <Match when={usage()}>
          {(current) => {
            const table = () => HamzadUsageText.table(current().models, name, width())
            const period = `Last ${current().days} days`
            return (
              <box gap={1}>
                <box>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    {Brand.money.exact(current().available)} left
                  </text>
                  <Show when={current().pending > 0}>
                    <text fg={theme.text.muted} wrapMode="word">
                      {HamzadUsageText.spent(current().pending)} cr used and not yet a line in your credit history
                    </text>
                  </Show>
                </box>
                <box>
                  <For
                    each={[
                      { label: "Today", ...current().today },
                      { label: period, ...current().total },
                    ]}
                  >
                    {(row) => (
                      <text fg={theme.text.base} wrapMode="none">
                        {row.label.padEnd(period.length + 3)}
                        <span style={{ fg: theme.text.muted }}>
                          {HamzadUsageText.requests(row.requests).padEnd(18)}
                        </span>
                        {HamzadUsageText.spent(row.credits)} cr
                      </text>
                    )}
                  </For>
                </box>
                <Show
                  when={current().models.length > 0}
                  fallback={<text fg={theme.text.muted}>Nothing used in the last {current().days} days.</text>}
                >
                  <box>
                    <text fg={theme.text.muted} wrapMode="none">
                      {table().head}
                    </text>
                    <For each={table().rows}>
                      {(row) => (
                        <text fg={theme.text.base} wrapMode="none">
                          {row}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
                <box>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text.muted}>Add credits:</text>
                    <Link href={Brand.billing} fg={theme.text.base} wrapMode="none" />
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text.muted}>Keys and every request:</text>
                    <Link href={Brand.settings} fg={theme.text.base} wrapMode="none" />
                  </box>
                </box>
              </box>
            )
          }}
        </Match>
        <Match when={usage() === null}>
          <text fg={theme.text.muted} wrapMode="word">
            {HamzadStatus.account(state(), signedIn())}
          </text>
        </Match>
        <Match when={true}>
          <text fg={theme.text.muted}>Loading…</text>
        </Match>
      </Switch>
    </DialogLayout>
  )
}
