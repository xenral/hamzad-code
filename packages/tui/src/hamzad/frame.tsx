import type { BorderCharacters, RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { NARROW } from "./look"

const rounded: BorderCharacters = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  topT: "┬",
  bottomT: "┴",
  leftT: "├",
  rightT: "┤",
  cross: "┼",
}

/** Whether the frame drops its sides at this width. */
export const narrow = (width: number) => width < NARROW

/**
 * One edge of a frame: its corner, what it carries on the left and on the right, and the line
 * between them, which takes whatever room is left. The left side gives way first when the room
 * runs out; nothing is drawn past the edge.
 */
export function Edge(props: {
  side: "top" | "bottom"
  left?: JSX.Element
  right?: JSX.Element
  color?: RGBA
  /** Whether the left side spaces itself, for content that may turn out to be empty. */
  bare?: boolean
  /** Columns the left side keeps however little room there is, e.g. for a name that must show. */
  leftMin?: number
  /** Whether the right side may give way too, after the left has given what it can. */
  rightShrinks?: boolean
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const color = () => props.color ?? theme.border.base
  const open = () => narrow(dimensions().width)
  const start = () => (open() ? "─" : props.side === "top" ? "╭─" : "╰─")
  const end = () => (open() ? "─" : props.side === "top" ? "─╮" : "─╯")
  return (
    <box flexDirection="row" height={1} flexShrink={0} width="100%" minWidth={0}>
      <text fg={color()} flexShrink={0} wrapMode="none" selectable={false}>
        {start()}
      </text>
      <Show when={props.left}>
        <box
          flexDirection="row"
          flexShrink={1}
          minWidth={props.leftMin ?? 0}
          paddingLeft={props.bare ? 0 : 1}
          paddingRight={props.bare ? 0 : 1}
        >
          {props.left}
        </box>
      </Show>
      <box
        flexGrow={1}
        flexShrink={1}
        minWidth={1}
        height={1}
        border={["top"]}
        borderColor={color()}
        customBorderChars={rounded}
      />
      <Show when={props.right}>
        <box flexDirection="row" flexShrink={props.rightShrinks ? 1 : 0} minWidth={0} paddingLeft={1} paddingRight={1}>
          {props.right}
        </box>
      </Show>
      <text fg={color()} flexShrink={0} wrapMode="none" selectable={false}>
        {end()}
      </text>
    </box>
  )
}

/**
 * The frame's sides around its content; below the narrow width there are none. `roomy` keeps a
 * line of space above and below the content.
 */
export function Sides(props: {
  children: JSX.Element
  grow?: boolean
  color?: RGBA
  tight?: boolean
  roomy?: boolean
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  return (
    <box
      flexGrow={props.grow ? 1 : 0}
      flexShrink={props.grow ? 1 : 0}
      minHeight={0}
      width="100%"
      // No sides is an empty list, not false: a box given a border colour draws all four when false.
      border={narrow(dimensions().width) ? [] : ["left", "right"]}
      borderColor={props.color ?? theme.border.base}
      customBorderChars={rounded}
      paddingLeft={narrow(dimensions().width) ? 0 : 1}
      paddingRight={narrow(dimensions().width) || props.tight ? 0 : 1}
      paddingTop={props.roomy ? 1 : 0}
      paddingBottom={props.roomy ? 1 : 0}
    >
      {props.children}
    </box>
  )
}
