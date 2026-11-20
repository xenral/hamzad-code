import { describe, expect, test } from "bun:test"
import { shortFolder } from "../../src/hamzad/folder"

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
