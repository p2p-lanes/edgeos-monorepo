import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ApplicationPublic } from "@/client"
import { ApplicationStatusStepper } from "./ApplicationStatusStepper"

const application = {
  id: "application-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  human_id: "human-1",
  sales_flow_id: "flow-1",
  status: "withdrawn",
  submitted_at: "2026-07-01T12:00:00Z",
  accepted_at: "2026-08-02T12:00:00Z",
} satisfies ApplicationPublic

describe("ApplicationStatusStepper", () => {
  it("shows Withdrawn instead of Accepted without reusing the acceptance date", () => {
    render(<ApplicationStatusStepper application={application} />)
    expect(screen.getByText("Withdrawn")).toBeVisible()
    expect(screen.queryByText("Accepted")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        new Date(application.accepted_at).toLocaleDateString(),
      ),
    ).not.toBeInTheDocument()
  })
  it.each(["accepted", "rejected"])("keeps the %s outcome", (status) => {
    render(
      <ApplicationStatusStepper application={{ ...application, status }} />,
    )
    expect(
      screen.getByText(status === "accepted" ? "Accepted" : "Rejected"),
    ).toBeVisible()
    expect(screen.queryByText("Withdrawn")).not.toBeInTheDocument()
  })
})
