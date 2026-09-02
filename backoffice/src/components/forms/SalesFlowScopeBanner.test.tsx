import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SalesFlowScopeBanner } from "./SalesFlowScopeBanner"

describe("SalesFlowScopeBanner", () => {
  it("names the flow being edited and states the edit scope", () => {
    render(<SalesFlowScopeBanner flowName="VIP Upgrade" />)

    expect(
      screen.getByText(/editing sales flow: vip upgrade/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/changes here apply only to this flow/i),
    ).toBeInTheDocument()
  })
})
