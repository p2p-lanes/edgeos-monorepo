/**
 * Tests for TenantForm — landing_mode toggle (tenant-direct-checkout-domain)
 *
 * Covers:
 * - BK-1: toggle disabled when custom_domain_active=false
 * - BK-2: toggle enabled when custom_domain_active=true
 * - BK-3: warning shown when switching to checkout AND >1 active popup
 * - BK-4: no warning when switching to checkout AND <=1 active popup
 * - BK-5: toggle is visible to admins, hidden for roles without admin rights
 * - BK-6: PATCH payload includes landing_mode on form submit
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

vi.mock("@/client", () => ({
  TenantsService: {
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
  },
  PopupsService: {
    listPopups: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}))

const mockUseAuth = vi.fn(() => ({ isSuperadmin: true, isAdmin: true }))

vi.mock("@/hooks/useAuth", () => ({
  default: () => mockUseAuth(),
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

import { PopupsService, TenantsService } from "@/client"
import { TenantForm } from "./TenantForm"

const mockListPopups = vi.mocked(PopupsService.listPopups)
const mockUpdateTenant = vi.mocked(TenantsService.updateTenant)

// A fully active tenant with custom domain
const TENANT_WITH_ACTIVE_DOMAIN = {
  id: "tenant-1",
  name: "Acme Events",
  slug: "acme",
  custom_domain: "tickets.acme.com",
  custom_domain_active: true,
  landing_mode: "portal" as const,
  sender_email: null,
  sender_name: null,
  image_url: null,
  icon_url: null,
  logo_url: null,
  deleted: false,
}

// A tenant with an inactive custom domain
const TENANT_WITH_INACTIVE_DOMAIN = {
  ...TENANT_WITH_ACTIVE_DOMAIN,
  custom_domain_active: false,
}

function makePopupResult(count: number, status = "active") {
  return {
    results: Array.from({ length: count }, (_, i) => ({
      id: `popup-${i}`,
      name: `Popup ${i}`,
      slug: `popup-${i}`,
      tenant_id: "tenant-1",
      status,
    })),
    total: count,
  }
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

describe("TenantForm — landing_mode toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to superadmin for each test
    mockUseAuth.mockReturnValue({ isSuperadmin: true, isAdmin: true })
    // Default: one active popup (no warning)
    mockListPopups.mockResolvedValue(
      makePopupResult(1) as Awaited<
        ReturnType<typeof PopupsService.listPopups>
      >,
    )
  })

  // BK-1: toggle disabled when domain is inactive
  it("BK-1: toggle is disabled when custom_domain_active=false", async () => {
    render(
      <TenantForm
        defaultValues={TENANT_WITH_INACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText(/landing mode/i)).toBeInTheDocument()
    })

    const toggle = screen.getByRole("switch", {
      name: /landing mode|direct checkout/i,
    })
    expect(toggle).toBeDisabled()
  })

  // BK-2: toggle enabled when domain is active
  it("BK-2: toggle is enabled when custom_domain_active=true", async () => {
    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText(/landing mode/i)).toBeInTheDocument()
    })

    const toggle = screen.getByRole("switch", {
      name: /landing mode|direct checkout/i,
    })
    expect(toggle).not.toBeDisabled()
  })

  // BK-3: warning shown when >1 active popup and toggle flipped to checkout
  it("BK-3: shows warning when flipped to checkout and >1 active popup", async () => {
    const user = userEvent.setup()
    mockListPopups.mockResolvedValue(
      makePopupResult(3) as Awaited<
        ReturnType<typeof PopupsService.listPopups>
      >,
    )

    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /landing mode|direct checkout/i }),
      ).toBeInTheDocument()
    })

    const toggle = screen.getByRole("switch", {
      name: /landing mode|direct checkout/i,
    })
    await user.click(toggle)

    await waitFor(() => {
      expect(
        screen.getByText(/more than one active popup/i),
      ).toBeInTheDocument()
    })
  })

  // BK-4: no warning when <=1 active popup
  it("BK-4: no warning when flipped to checkout and <=1 active popup", async () => {
    const user = userEvent.setup()
    // default mock already has 1 popup

    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /landing mode|direct checkout/i }),
      ).toBeInTheDocument()
    })

    const toggle = screen.getByRole("switch", {
      name: /landing mode|direct checkout/i,
    })
    await user.click(toggle)

    // Wait a tick then verify no warning
    await waitFor(() => {
      expect(screen.queryByText(/more than one active popup/i)).toBeNull()
    })
  })

  // BK-5a: ADMIN can see the toggle
  it("BK-5: toggle is rendered for admin users", async () => {
    mockUseAuth.mockReturnValue({ isSuperadmin: false, isAdmin: true })

    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /landing mode|direct checkout/i }),
      ).toBeInTheDocument()
    })
  })

  // BK-5b: roles without admin rights (e.g. viewer/operator) cannot see the toggle
  it("BK-5: toggle is not rendered for users without admin rights", async () => {
    mockUseAuth.mockReturnValue({ isSuperadmin: false, isAdmin: false })

    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    // Give enough time for the form to settle
    await new Promise((r) => setTimeout(r, 100))

    expect(
      screen.queryByRole("switch", { name: /landing mode|direct checkout/i }),
    ).toBeNull()
  })

  // BK-6: PATCH payload includes landing_mode on submit
  it("BK-6: PATCH payload includes landing_mode when form is submitted", async () => {
    const user = userEvent.setup()
    mockUpdateTenant.mockResolvedValue(
      TENANT_WITH_ACTIVE_DOMAIN as Awaited<
        ReturnType<typeof TenantsService.updateTenant>
      >,
    )

    render(
      <TenantForm
        defaultValues={TENANT_WITH_ACTIVE_DOMAIN}
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /landing mode|direct checkout/i }),
      ).toBeInTheDocument()
    })

    // Flip toggle to checkout
    const toggle = screen.getByRole("switch", {
      name: /landing mode|direct checkout/i,
    })
    await user.click(toggle)

    // Submit form
    const submitBtn = screen.getByRole("button", { name: /save changes/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(mockUpdateTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            landing_mode: "checkout",
          }),
        }),
      )
    })
  })
})
