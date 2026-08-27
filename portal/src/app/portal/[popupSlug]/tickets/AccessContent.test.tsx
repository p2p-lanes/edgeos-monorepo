import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccessContent } from "./AccessContent"
import type { ScannableAccessHolder } from "./accessProjection"

const translations: Record<string, string> = {
  "tickets_access.title": "Tickets & Access",
  "tickets_access.description": "Scannable passes grouped by holder.",
  "tickets_access.empty_title": "No tickets yet",
  "tickets_access.empty_description": "Scannable tickets will appear here.",
  "tickets_access.show_code": "Show access code for {{ticket}}",
  "tickets_access.checked_in": "Checked in",
  "tickets_access.active": "Ready for check-in",
  "tickets_access.code_title": "Access code",
  "tickets_access.code_description": "Use this code to check in.",
  "tickets_access.duration.day": "Daily event access",
  "tickets_access.duration.week": "Weekly event access",
  "tickets_access.duration.month": "Monthly event access",
  "tickets_access.duration.full": "Full event access",
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { ticket?: string }) =>
      key === "tickets_access.show_code"
        ? `Show access code for ${values?.ticket}`
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
        access={
          [
            {
              holderId: "holder-alex",
              holderName: "Alex Morgan",
              tickets: [
                {
                  id: "ticket",
                  name: "General Admission",
                  checkInCode: "CHECK-IN-1",
                  lastScanAt: null,
                  category: "General",
                  duration: "week",
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
                  category: null,
                  duration: null,
                },
              ],
            },
          ] as unknown as ScannableAccessHolder[]
        }
      />,
    )

    expect(screen.getByText("Scannable passes grouped by holder.")).toBeTruthy()

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
        name: "Show access code for Volunteer Access",
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
        access={
          [
            {
              holderId: "holder",
              holderName: "Jamie Morgan",
              tickets: [
                {
                  id: "ticket",
                  name: "Volunteer Access",
                  checkInCode: "CHECK-IN-2",
                  lastScanAt: "2026-08-21T12:00:00Z",
                  category: null,
                  duration: null,
                },
              ],
            },
          ] as unknown as ScannableAccessHolder[]
        }
      />,
    )

    expect(screen.getByText("Checked in")).toBeTruthy()
    expect(screen.queryByText("Pass details unavailable")).toBeNull()
    expect(screen.queryByText("General")).toBeNull()
    expect(screen.queryByText("week")).toBeNull()
    expect(
      screen.getByRole("button", {
        name: "Show access code for Volunteer Access",
      }),
    ).toBeTruthy()
  })

  it("shows a no-ticket state without a purchase action", () => {
    render(<AccessContent access={[]} />)

    expect(screen.getByText("No tickets yet")).toBeTruthy()
    expect(screen.getByText("Scannable tickets will appear here.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /shop|buy/i })).toBeNull()
  })
})
