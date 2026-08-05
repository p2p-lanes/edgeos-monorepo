import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SalesFlowVisibilityNote } from "./SalesFlowVisibilityNote"

describe("SalesFlowVisibilityNote", () => {
  it("explains upsale flows surface on the portal passes page to eligible buyers", () => {
    render(<SalesFlowVisibilityNote type="upsale" visibility="portal_listed" />)

    expect(screen.getByText(/portal passes page/i)).toBeInTheDocument()
    expect(
      screen.getByText(/not listed in the application flow picker/i),
    ).toBeInTheDocument()
  })

  it("states a direct_url_only flow is reachable only by its direct link", () => {
    render(
      <SalesFlowVisibilityNote type="direct" visibility="direct_url_only" />,
    )

    expect(
      screen.getByText(/reachable only through its direct link/i),
    ).toBeInTheDocument()
  })

  it("notes portal listing isn't wired up yet for a portal_listed direct flow", () => {
    render(<SalesFlowVisibilityNote type="direct" visibility="portal_listed" />)

    expect(screen.getByText(/isn't wired up yet/i)).toBeInTheDocument()
  })

  it("explains application flows surface in the portal's flow picker", () => {
    render(
      <SalesFlowVisibilityNote type="application" visibility="portal_listed" />,
    )

    expect(screen.getByText(/application flow picker/i)).toBeInTheDocument()
  })
})
