import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccessContent } from "./AccessContent"

const translations: Record<string, string> = {
  "tickets_access.title": "Tickets & Access",
  "tickets_access.description": "Your active event tickets and check-in items.",
  "tickets_access.empty_title": "No tickets or check-in items yet",
  "tickets_access.empty_description":
    "Active event tickets and check-in items will appear here.",
  "tickets_access.purchased_by_you": "Purchased by you",
  "tickets_access.show_code": "Show check-in code for {{ticket}}",
  "tickets_access.checked_in": "Checked in",
  "tickets_access.active": "Ready for check-in",
  "tickets_access.access_active": "Access active",
  "tickets_access.code_title": "Check-in code",
  "tickets_access.code_description": "Use this code when checking in.",
  "tickets_access.duration.day": "Daily event access",
  "tickets_access.duration.week": "Weekly event access",
  "tickets_access.duration.month": "Monthly event access",
  "tickets_access.duration.full": "Full event access",
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { ticket?: string }) =>
      key === "tickets_access.show_code"
        ? `Show check-in code for ${values?.ticket}`
        : (translations[key] ?? key),
  }),
}))

vi.mock("react-qr-code", () => ({
  default: ({ size }: { size: number }) => (
    <svg aria-label="QR code" data-size={size} />
  ),
}))

describe("AccessContent", () => {
  it("keeps plain holder headings outside ticket cards with per-holder codes and QR interactions", () => {
    render(
      <AccessContent
        access={[
          {
            holderId: "holder-alex",
            holderName: "Alex Morgan",
            tickets: [
              {
                id: "ticket",
                name: "General Admission",
                checkInCode: "CHECK-IN-1",
                lastScanAt: null,
                duration: "week",
                requiresCheckIn: true,
                grantsEventAccess: true,
              },
            ],
          },
          {
            holderId: "holder-jamie",
            holderName: "Jamie Morgan",
            tickets: [
              {
                id: "ticket-jamie",
                name: "Volunteer Access",
                checkInCode: "CHECK-IN-2",
                lastScanAt: null,
                duration: null,
                requiresCheckIn: true,
                grantsEventAccess: true,
              },
            ],
          },
        ]}
      />,
    )

    expect(
      screen.getByText("Your active event tickets and check-in items."),
    ).toBeTruthy()

    const alexHeading = screen.getByRole("heading", {
      level: 2,
      name: "Alex Morgan",
    })
    const alexHolder = alexHeading.closest("section")
    const jamieHeading = screen.getByRole("heading", {
      level: 2,
      name: "Jamie Morgan",
    })
    const jamieHolder = jamieHeading.closest("section")

    expect(alexHolder?.getAttribute("aria-labelledby")).toBe(alexHeading.id)
    expect(alexHolder?.querySelector(":scope > h2")).toBe(alexHeading)
    expect(jamieHolder?.getAttribute("aria-labelledby")).toBe(jamieHeading.id)
    expect(jamieHolder?.querySelector(":scope > h2")).toBe(jamieHeading)
    expect(screen.queryByText("AM")).toBeNull()
    expect(screen.queryByText("JM")).toBeNull()
    expect(document.querySelector('[data-lucide="users"]')).toBeNull()

    expect(screen.getByText("General Admission")).toBeTruthy()
    expect(
      within(alexHolder as HTMLElement).getByText("Ready for check-in"),
    ).toBeTruthy()
    expect(
      within(alexHolder as HTMLElement).getByText("CHECK-IN-1"),
    ).toBeTruthy()
    expect(
      within(jamieHolder as HTMLElement).getByText("CHECK-IN-2"),
    ).toBeTruthy()
    expect(
      within(alexHolder as HTMLElement).getByText("Weekly event access"),
    ).toBeTruthy()
    expect(screen.queryByText("General")).toBeNull()
    expect(screen.queryByText("week")).toBeNull()
    expect(screen.getAllByLabelText("QR code")).toHaveLength(2)
    expect(
      screen.getAllByLabelText("QR code")[0]?.getAttribute("data-size"),
    ).toBe("96")

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show check-in code for Volunteer Access",
      }),
    )

    expect(screen.getAllByText("CHECK-IN-2")).toHaveLength(2)
    expect(screen.getAllByLabelText("QR code")).toHaveLength(3)
    expect(
      screen.getAllByLabelText("QR code")[2]?.getAttribute("data-size"),
    ).toBe("200")
  })

  it("omits metadata when no user-facing duration is available", () => {
    render(
      <AccessContent
        access={[
          {
            holderId: "holder",
            holderName: "Jamie Morgan",
            tickets: [
              {
                id: "ticket",
                name: "Volunteer Access",
                checkInCode: "CHECK-IN-2",
                lastScanAt: "2026-08-21T12:00:00Z",
                duration: null,
                requiresCheckIn: true,
                grantsEventAccess: true,
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText("Checked in")).toBeTruthy()
    expect(screen.queryByText("Pass details unavailable")).toBeNull()
    expect(screen.queryByText("General")).toBeNull()
    expect(screen.queryByText("week")).toBeNull()
    expect(
      screen.getByRole("button", {
        name: "Show check-in code for Volunteer Access",
      }),
    ).toBeTruthy()
  })

  it("shows non-scannable access without check-in controls or readiness", () => {
    render(
      <AccessContent
        access={[
          {
            holderId: "holder",
            holderName: "Alex Morgan",
            tickets: [
              {
                id: "ticket",
                name: "Speaker Access",
                checkInCode: "HIDDEN-CODE",
                lastScanAt: null,
                duration: null,
                requiresCheckIn: false,
                grantsEventAccess: true,
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText("Alex Morgan")).toBeTruthy()
    expect(screen.getByText("Speaker Access")).toBeTruthy()
    expect(screen.getByText("Access active")).toBeTruthy()
    expect(screen.queryByText("HIDDEN-CODE")).toBeNull()
    expect(screen.queryByText("Ready for check-in")).toBeNull()
    expect(screen.queryByText("Checked in")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByLabelText("QR code")).toBeNull()
  })

  it("shows purchased parking check-in without claiming event access", () => {
    render(
      <AccessContent
        access={[
          {
            holderId: "purchased-by-you",
            holderName: null,
            tickets: [
              {
                id: "parking",
                name: "Parking",
                checkInCode: "PARK1234",
                lastScanAt: null,
                duration: "full",
                requiresCheckIn: true,
                grantsEventAccess: false,
              },
            ],
          },
        ]}
      />,
    )

    expect(
      screen.getByRole("heading", { level: 2, name: "Purchased by you" }),
    ).toBeTruthy()
    expect(screen.getByText("Parking")).toBeTruthy()
    expect(screen.getByText("Ready for check-in")).toBeTruthy()
    expect(screen.getByText("PARK1234")).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "Show check-in code for Parking",
      }),
    ).toBeTruthy()
    expect(screen.queryByText("Full event access")).toBeNull()
    expect(screen.queryByText("Access active")).toBeNull()
  })

  it("shows a no-ticket state without a purchase action", () => {
    render(<AccessContent access={[]} />)

    expect(screen.getByText("No tickets or check-in items yet")).toBeTruthy()
    expect(
      screen.getByText(
        "Active event tickets and check-in items will appear here.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: /shop|buy/i })).toBeNull()
  })
})
