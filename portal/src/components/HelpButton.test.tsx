import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.popup ? `${key}:${opts.popup}` : key,
  }),
}))

let tenantState: {
  help_enabled?: boolean | null
  help_email?: string | null
  sender_email?: string | null
}
vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenant: tenantState }),
}))

let popupState: { name?: string } | null
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => popupState }),
}))

import HelpButton from "./HelpButton"

describe("HelpButton", () => {
  beforeEach(() => {
    popupState = { name: "Tech Summit" }
  })

  it("renders nothing when the tenant has help disabled", () => {
    tenantState = { help_enabled: false, help_email: "support@acme.com" }
    render(<HelpButton />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders nothing when help is enabled but no help_email is set", () => {
    tenantState = { help_enabled: true, help_email: null }
    render(<HelpButton />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders nothing when help_email is only whitespace", () => {
    tenantState = { help_enabled: true, help_email: "   " }
    render(<HelpButton />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("does not fall back to sender_email", () => {
    tenantState = {
      help_enabled: true,
      help_email: null,
      sender_email: "noreply@acme.com",
    }
    render(<HelpButton />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders the button when help is enabled and an address is configured", () => {
    tenantState = { help_enabled: true, help_email: "support@acme.com" }
    render(<HelpButton />)
    expect(screen.getByRole("button", { name: "help.aria_label" })).toBeTruthy()
  })
})
