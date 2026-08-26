import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccessContent } from "./AccessContent"
import type { ScannableAccessHolder } from "./accessProjection"

const translations: Record<string, string> = {
  "tickets_access.title": "Tickets & Access",
  "tickets_access.description": "Your scannable event access.",
  "tickets_access.empty_title": "No tickets yet",
  "tickets_access.empty_description": "Scannable tickets will appear here.",
  "tickets_access.show_code": "Show access code for {{ticket}}",
  "tickets_access.checked_in": "Checked in",
  "tickets_access.active": "Ready for check-in",
  "tickets_access.code_title": "Access code",
  "tickets_access.code_description": "Use this code to check in.",
  "tickets_access.details_unavailable": "Pass details unavailable",
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
  default: () => <svg aria-label="QR code" />,
}))

describe("AccessContent", () => {
  it("shows scan-first ticket metadata under its holder and opens its stable code", () => {
    render(
      <AccessContent
        access={
          [
            {
              holderId: "holder",
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
          ] as unknown as ScannableAccessHolder[]
        }
      />,
    )

    expect(screen.getByText("Alex Morgan")).toBeTruthy()
    expect(screen.getByText("General Admission")).toBeTruthy()
    expect(screen.getByText("Ready for check-in")).toBeTruthy()
    expect(screen.getByText("CHECK-IN-1")).toBeTruthy()
    expect(screen.getByText("General")).toBeTruthy()
    expect(screen.getByText("week")).toBeTruthy()
    expect(screen.getAllByLabelText("QR code")).toHaveLength(1)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show access code for General Admission",
      }),
    )

    expect(screen.getAllByText("CHECK-IN-1")).toHaveLength(2)
    expect(screen.getAllByLabelText("QR code")).toHaveLength(2)
  })

  it("uses the localized unavailable fallback without inventing missing pass details", () => {
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
    expect(screen.getByText("Pass details unavailable")).toBeTruthy()
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
