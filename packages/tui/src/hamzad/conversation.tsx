import { Brand } from "@opencode/util/brand"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { useData } from "../context/data"
import { useTuiPaths } from "../context/runtime"
import { useTheme } from "../context/theme"
import { abbreviateHome } from "../runtime"
import { Edge, Sides } from "./frame"
import { framed } from "./look"

/** Where a session works, as its frame and the prompt name it: the folder, and the branch when there is one. */
export function useFolder(location: () => { directory: string } | undefined) {
  const data = useData()
  const paths = useTuiPaths()
  return () => {
    const current = location()
    if (!current) return undefined
    const directory = abbreviateHome(current.directory, paths.home)
    const branch = data.location.vcs.info(current as never)?.branch.current
    return branch ? `${directory}:${branch}` : directory
  }
}

/**
 * The conversation in one rounded frame: `hamzad`, and the session's title once it has one, on the
 * top edge, the folder on its right. Upstream's build gets its transcript as it was.
 */
export function HamzadConversation(props: { sessionID: string; children: JSX.Element }) {
  if (!framed) return props.children
  const theme = useTheme()
  const data = useData()
  const dimensions = useTerminalDimensions()
  const session = () => data.session.get(props.sessionID)
  const folder = useFolder(() => session()?.location)
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <Edge
        side="top"
        left={
          <>
            <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
              <b>{Brand.cli}</b>
            </text>
            <Show when={session()?.title}>
              {(title) => (
                <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
                  {` · ${title()}`}
                </text>
              )}
            </Show>
          </>
        }
        right={
          <Show when={dimensions().width >= 44 && folder()}>
            {(value) => (
              <text fg={theme.text.muted} wrapMode="none">
                {value()}
              </text>
            )}
          </Show>
        }
      />
      <Sides grow>{props.children}</Sides>
      <Edge side="bottom" />
    </box>
  )
}
