import type { BorderCharacters, BorderSides, RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { own } from "./look"

/**
 * Upstream's block with a coloured bar down its left side and a filled background. In Hamzad's
 * layout it is a plain box: a speaker's name marks the words, and the terminal's own background
 * shows through.
 * (A box draws its border as soon as it is given a border colour or border characters, so the
 * plain box is given neither.)
 */
export function HamzadBar(props: {
  border: BorderSides[]
  borderColor: RGBA
  customBorderChars: BorderCharacters
  backgroundColor?: RGBA
  width?: "100%"
  children: JSX.Element
}) {
  if (own) return <box width={props.width}>{props.children}</box>
  return (
    <box
      width={props.width}
      border={props.border}
      borderColor={props.borderColor}
      customBorderChars={props.customBorderChars}
      backgroundColor={props.backgroundColor}
    >
      {props.children}
    </box>
  )
}
