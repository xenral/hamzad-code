import { describe, expect, test } from "bun:test"
import { fitEdge, shortFolder } from "../../src/hamzad/folder"
import { stringWidth } from "../../src/util/string-width"

describe("a folder on a frame's edge", () => {
  test("is shown whole when it fits", () => {
    expect(shortFolder("~/project", 20)).toBe("~/project")
  })

  test("is cut from its start, keeping whole names at its end", () => {
    const deep = "/private/var/folders/x1/abc123def456/T/hamzad-e2e-AbCd12/project"
    expect(shortFolder(deep, 30)).toBe("…/T/hamzad-e2e-AbCd12/project")
    expect(shortFolder(deep, 16)).toBe("…/project")
  })

  test("keeps the branch that follows the last name", () => {
    expect(shortFolder("/home/someone/work/clients/shop:main", 16)).toBe("…/shop:main")
  })

  test("keeps the end of a single name longer than the room", () => {
    expect(shortFolder("/a/averyveryverylongprojectname", 10)).toBe("…ojectname")
  })
})

describe("the prompt frame's bottom edge", () => {
  const items = [
    { text: "4,980.88 cr", drop: 0 },
    { text: "ctrl+p menu", drop: 3 },
  ]
  // The corners, the folder and its spaces, a column of line, the right side and its spaces.
  const drawn = (edge: { folder?: string; status: string[] }, ends: number) =>
    ends + (edge.folder ? stringWidth(edge.folder) + 2 : 0) + 1 + stringWidth(edge.status.join(" · ")) + 2

  test("fits a long folder in the frame's own width, shortened once from its start", () => {
    const folder = "~/work/hamzad-code/hamzad-code/packages/cli:main"
    const edge = fitEdge({ width: 75, ends: 4, folder, items })
    expect(edge.status).toEqual(["4,980.88 cr", "ctrl+p menu"])
    expect(edge.folder).toBe("…/hamzad-code/packages/cli:main")
    expect(drawn(edge, 4)).toBeLessThanOrEqual(75)
  })

  test("shows a short folder whole", () => {
    expect(fitEdge({ width: 75, ends: 4, folder: "~/shop:main", items }).folder).toBe("~/shop:main")
  })

  test("drops the menu's key before the credits when short of room", () => {
    const edge = fitEdge({ width: 40, ends: 2, folder: "~/work/clients/shop-front:main", items })
    expect(edge.status).toEqual(["4,980.88 cr"])
    expect(edge.folder).toBe("…/shop-front:main")
    expect(drawn(edge, 2)).toBeLessThanOrEqual(40)
  })
})
