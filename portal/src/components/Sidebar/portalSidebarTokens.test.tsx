import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const stylesheet = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
)
const sidebarRuleStart = stylesheet.indexOf(".portal-chrome.portal-sidebar")
const sidebarRuleEnd = stylesheet.indexOf("}\n", sidebarRuleStart)
const sidebarRule = stylesheet.slice(sidebarRuleStart, sidebarRuleEnd)

describe("Portal sidebar tokens", () => {
  it("uses its navy palette inside Portal chrome", () => {
    expect(sidebarRule).toContain("--sidebar: oklch(0.21 0.04 260)")
    expect(sidebarRule).toContain("--sidebar-accent: oklch(0.55 0.2 260)")
  })

  it("does not inherit a flow sidebar token", () => {
    expect(sidebarRule).toContain(".portal-chrome .portal-sidebar")
    expect(sidebarRule).toContain("--popover: var(--sidebar)")
  })
})
