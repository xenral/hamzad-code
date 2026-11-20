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
