import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ExpiredPreparedFileTool } from "./ToolShell"

describe("expired prepared file card", () => {
  it.each([
    ["custom-export", "Prepared export expired"],
    ["download", "Prepared file expired"],
  ] as const)("renders an actionable %s state", (kind, title) => {
    render(<ExpiredPreparedFileTool kind={kind} />)

    expect(screen.getByText("Expired")).toBeInTheDocument()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(
      screen.getByText(/Ask EdgeOS to prepare it again/),
    ).toBeInTheDocument()
  })
})
