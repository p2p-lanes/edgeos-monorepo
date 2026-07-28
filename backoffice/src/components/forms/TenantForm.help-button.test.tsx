/**
 * Tests for TenantForm — portal help button config (help_enabled / help_email)
 *
 * Covers:
 * - the toggle and address round-trip into the PATCH payload
 * - enabling without an address blocks the save (no PATCH fired)
 * - an invalid address blocks the save
 * - a blank address is sent as null when the button stays off
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  TenantsService: {
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
    sendSmtpTestEmail: vi.fn(),
  },
  PopupsService: {
    listPopups: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({
    isSuperadmin: true,
    isAdmin: true,
    user: { email: "admin@acme.com" },
  }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

vi.mock("@/hooks/useUnsavedChanges", () => ({
  useUnsavedChanges: () => ({ state: "unblocked" }),
  UnsavedChangesDialog: () => null,
}))

vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: () => null,
}))

vi.mock("@/components/forms/TenantCredentialsSection", () => ({
  TenantCredentialsSection: () => null,
}))

import { PopupsService, TenantsService } from "@/client"
import { TenantForm } from "./TenantForm"

const mockListPopups = vi.mocked(PopupsService.listPopups)
const mockUpdateTenant = vi.mocked(TenantsService.updateTenant)

const BASE_TENANT = {
  id: "tenant-1",
  name: "Acme Events",
  slug: "acme",
  custom_domain: null,
  custom_domain_active: false,
  landing_mode: "portal" as const,
  sender_email: null,
  sender_name: null,
  image_url: null,
  icon_url: null,
  logo_url: null,
  deleted: false,
  help_enabled: false,
  help_email: null,
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Save Changes" }))
}

describe("TenantForm — portal help button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListPopups.mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 100, total: 0 },
    } as Awaited<ReturnType<typeof PopupsService.listPopups>>)
    mockUpdateTenant.mockResolvedValue({} as never)
  })

  it("sends help_enabled and help_email in the PATCH payload", async () => {
    const user = userEvent.setup()
    render(<TenantForm defaultValues={BASE_TENANT} onSuccess={vi.fn()} />, {
      wrapper: makeWrapper(),
    })

    await user.click(screen.getByRole("switch", { name: "Help Button" }))
    await user.type(
      screen.getByPlaceholderText("support@acme.com"),
      "support@acme.com",
    )
    await save(user)

    await waitFor(() => {
      expect(mockUpdateTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            help_enabled: true,
            help_email: "support@acme.com",
          }),
        }),
      )
    })
  })

  it("blocks the save when the button is enabled with no address", async () => {
    const user = userEvent.setup()
    render(<TenantForm defaultValues={BASE_TENANT} onSuccess={vi.fn()} />, {
      wrapper: makeWrapper(),
    })

    await user.click(screen.getByRole("switch", { name: "Help Button" }))
    await save(user)

    await waitFor(() => {
      expect(
        screen.getByText(
          "Help email is required when the help button is enabled",
        ),
      ).toBeTruthy()
    })
    expect(mockUpdateTenant).not.toHaveBeenCalled()
  })

  it("blocks the save when the address is malformed", async () => {
    const user = userEvent.setup()
    render(<TenantForm defaultValues={BASE_TENANT} onSuccess={vi.fn()} />, {
      wrapper: makeWrapper(),
    })

    await user.click(screen.getByRole("switch", { name: "Help Button" }))
    await user.type(screen.getByPlaceholderText("support@acme.com"), "nope")
    await save(user)

    await waitFor(() => {
      expect(screen.getByText("Invalid email address")).toBeTruthy()
    })
    expect(mockUpdateTenant).not.toHaveBeenCalled()
  })

  it("sends help_email as null when the button stays off", async () => {
    const user = userEvent.setup()
    render(<TenantForm defaultValues={BASE_TENANT} onSuccess={vi.fn()} />, {
      wrapper: makeWrapper(),
    })

    await save(user)

    await waitFor(() => {
      expect(mockUpdateTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            help_enabled: false,
            help_email: null,
          }),
        }),
      )
    })
  })

  it("prefills both fields from the tenant", () => {
    render(
      <TenantForm
        defaultValues={{
          ...BASE_TENANT,
          help_enabled: true,
          help_email: "existing@acme.com",
        }}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    expect(screen.getByRole("switch", { name: "Help Button" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByPlaceholderText("support@acme.com")).toHaveValue(
      "existing@acme.com",
    )
  })
})
