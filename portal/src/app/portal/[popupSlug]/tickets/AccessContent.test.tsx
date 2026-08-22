import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccessContent } from "./AccessContent"

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
  it("shows a scannable ticket under its holder and opens its stable code", () => {
    render(
      <AccessContent
        access={[
          {
            holderId: "holder",
            holderName: "Alex Morgan",
            tickets: [
              {
                id: "ticket",
                name: "General Admission",
                checkInCode: "CHECK-IN-1",
                lastScanAt: null,
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText("Alex Morgan")).toBeTruthy()
    expect(screen.getByText("General Admission")).toBeTruthy()
    expect(screen.getByText("Ready for check-in")).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show access code for General Admission",
      }),
    )

    expect(screen.getByText("CHECK-IN-1")).toBeTruthy()
    expect(screen.getByLabelText("QR code")).toBeTruthy()
  })

  it("shows a no-ticket state without a purchase action", () => {
    render(<AccessContent access={[]} />)

    expect(screen.getByText("No tickets yet")).toBeTruthy()
    expect(screen.getByText("Scannable tickets will appear here.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /shop|buy/i })).toBeNull()
  })
})
