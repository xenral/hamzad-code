import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { SessionTurn } from "@opencode/util/session-turn"
import { createMemo, Show } from "solid-js"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { use } from "../routes/session/render-context"
import { Locale } from "../util/locale"

/** What the turn that ended with `message` cost: every step since the person's message. */
export function turnCost(messages: readonly SessionMessageInfo[], message: SessionMessageAssistant) {
  const end = messages.findIndex((item) => item.id === message.id)
  let total = 0
  for (let index = (end === -1 ? messages.length : end + 1) - 1; index >= 0; index--) {
    const item = messages[index]!
    if (item.type === "user" || item.type === "idle") break
    if (item.type === "assistant") total += item.cost ?? 0
  }
  return total
}

/**
 * Under an answer, on the right and quiet: how long the turn took and what it cost. The mode and
 * the model are on the prompt's frame, so they are not repeated here.
 */
export function HamzadAnswerFooter(props: { message: SessionMessageAssistant }) {
  const ctx = use()
  const data = useData()
  const theme = useTheme()
  const messages = createMemo(() => data.session.message.list(ctx.sessionID))
  const duration = createMemo(() =>
    SessionTurn.duration(messages(), props.message, {
      index: ctx.messageIndex(props.message.id),
      legacy: ctx.legacyTurns(),
    }),
  )
  const cost = createMemo(() => turnCost(messages(), props.message))
  const interrupted = () => props.message.error?.message === "Step interrupted"
  const parts = createMemo(() =>
    [
      duration() ? Locale.duration(duration()) : undefined,
      cost() > 0 ? Brand.money.fixed(cost()) : undefined,
      interrupted() ? "interrupted" : undefined,
    ].filter((item): item is string => Boolean(item)),
  )
  return (
    <Show when={parts().length > 0}>
      <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
        <text fg={theme.text.muted} wrapMode="none">
          {parts().join(" · ")}
        </text>
      </box>
    </Show>
  )
}
