import { useData } from "../context/data"
import { useTuiPaths } from "../context/runtime"
import { abbreviateHome } from "../runtime"
import { stringWidth } from "../util/string-width"

/** Where a session works, as the prompt's frame names it: the folder, and the branch when there is one. */
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
 * A folder cut to `max` columns from its start, keeping whole names at its end, so the part that
 * tells two projects apart stays: `/var/folders/x1/abc/T/work/shop` becomes `…/work/shop`.
 */
export function shortFolder(path: string, max: number) {
  if (stringWidth(path) <= max) return path
  const parts = path.split("/")
  let tail = parts.pop() ?? path
  while (parts.length > 0 && stringWidth(`…/${parts.at(-1)}/${tail}`) <= max) tail = `${parts.pop()}/${tail}`
  const short = `…/${tail}`
  if (stringWidth(short) <= max) return short
  // One name longer than the room: its end, which is the part that differs.
  return `…${[...tail].slice(-Math.max(1, max - 1)).join("")}`
}

/** One thing the prompt frame's bottom edge says on its right; `drop` 0 always stays, then 1 goes first, then 2, then 3. */
export type EdgeItem = { text: string; drop: number }

/**
 * What fits on the prompt frame's bottom edge, `width` columns from end to end with `ends` of them
 * taken by its two corners: the right side's items, dropping the least needed first, and the folder
 * in the room they leave, shortened once from its start so nothing is cut in its middle.
 */
export function fitEdge(input: { width: number; ends: number; folder?: string; items: EdgeItem[] }) {
  const join = (items: EdgeItem[]) => items.map((item) => item.text).join(" · ")
  // Less a column of line between the two sides, the spaces around the right side and the folder's.
  const room = Math.max(0, input.width - input.ends - 1 - 2 - (input.folder ? 2 : 0))
  // The folder keeps up to half the room before the right side gives anything up.
  const keep = input.folder ? Math.min(stringWidth(input.folder), Math.max(16, Math.floor(room / 2))) : 0
  let shown = input.items
  for (const level of [1, 2, 3]) {
    if (stringWidth(join(shown)) <= room - keep) break
    shown = shown.filter((item) => item.drop !== level)
  }
  return {
    folder: input.folder ? shortFolder(input.folder, Math.max(1, room - stringWidth(join(shown)))) : undefined,
    status: shown.map((item) => item.text),
  }
}
