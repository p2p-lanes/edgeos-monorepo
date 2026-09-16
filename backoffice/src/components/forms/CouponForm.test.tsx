import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createCoupon: vi.fn(),
  blockerOptions: null as {
    shouldBlockFn: () => boolean
    disabled: boolean
  } | null,
}))

vi.mock("@/client", () => ({
  CouponsService: {
    createCoupon: mocks.createCoupon,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
  },
  SalesFlowsService: {
    listSalesFlows: vi.fn().mockResolvedValue({
      results: [
        {
          id: "flow-1",
          name: "Default flow",
          type: "application",
          is_default: true,
        },
      ],
      paging: { limit: 100, offset: 0, total: 1 },
    }),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: (options: {
    shouldBlockFn: () => boolean
    disabled: boolean
  }) => {
    mocks.blockerOptions = options
    return { status: "unblocked" }
  },
}))

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    selectedPopupId: "popup-1",
    isContextReady: true,
  }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isOperatorOrAbove: true }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { CouponForm } from "./CouponForm"

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("CouponForm unsaved changes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blockerOptions = null
    mocks.createCoupon.mockResolvedValue({ id: "coupon-1" })
  })

  it("keeps ordinary dirty edits protected", async () => {
    const user = userEvent.setup()
    render(<CouponForm onSuccess={vi.fn()} />, { wrapper: Wrapper })

    await user.type(screen.getByPlaceholderText("COUPON CODE"), "summer")

    await waitFor(() => expect(mocks.blockerOptions?.disabled).toBe(false))
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)
  })

  it("enables the blocker bypass before success navigation", async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn(() => {
      expect(mocks.blockerOptions?.shouldBlockFn()).toBe(false)
    })
    render(<CouponForm onSuccess={onSuccess} />, { wrapper: Wrapper })

    await user.type(screen.getByPlaceholderText("COUPON CODE"), "summer")
    await user.click(screen.getByRole("button", { name: "Create Coupon" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(false)
  })
})
