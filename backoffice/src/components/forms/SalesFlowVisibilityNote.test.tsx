import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SalesFlowVisibilityNote } from "./SalesFlowVisibilityNote"

describe("SalesFlowVisibilityNote", () => {
  it("explains upsale flows surface on the portal passes page to eligible buyers", () => {
    render(<SalesFlowVisibilityNote type="upsale" />)

    expect(screen.getByText(/portal passes page/i)).toBeInTheDocument()
    expect(
      screen.getByText(/not listed in the application flow picker/i),
    ).toBeInTheDocument()
  })

  it("explains application flows surface in the portal's flow picker", () => {
    render(<SalesFlowVisibilityNote type="application" />)

    expect(screen.getByText(/application flow picker/i)).toBeInTheDocument()
  })
})
