import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  ApprovalStrategiesService: {
    getApprovalStrategy: vi.fn(),
    createOrUpdateApprovalStrategy: vi.fn(),
    deleteApprovalStrategy: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { ApprovalStrategiesService } from "@/client"
import { ApprovalStrategyForm } from "./ApprovalStrategyForm"

const getStrategy = vi.mocked(ApprovalStrategiesService.getApprovalStrategy)
const disableStrategy = vi.mocked(
  ApprovalStrategiesService.deleteApprovalStrategy,
)

const strategy = (strategyType: "auto_accept" | "any_reviewer") => ({
  id: "strategy-1",
  popup_id: "popup-1",
  tenant_id: "tenant-1",
  sales_flow_id: null,
  strategy_type: strategyType,
  required_approvals: 1,
  accept_threshold: 2,
  reject_threshold: -2,
  strong_yes_weight: 2,
  yes_weight: 1,
  no_weight: -1,
  strong_no_weight: -2,
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
})

function wrapper() {
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

describe("ApprovalStrategyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    disableStrategy.mockResolvedValue(undefined)
  })

  it("does not offer disable when review is already auto-accept", async () => {
    getStrategy.mockResolvedValue(strategy("auto_accept"))

    render(<ApprovalStrategyForm popupId="popup-1" />, { wrapper: wrapper() })

    expect(await screen.findByText("Auto Accept")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Disable Review" })).toBeNull()
  })

  it("uses the idempotent reset endpoint to disable manual review", async () => {
    const user = userEvent.setup()
    getStrategy.mockResolvedValue(strategy("any_reviewer"))

    render(<ApprovalStrategyForm popupId="popup-1" />, { wrapper: wrapper() })
    await user.click(
      await screen.findByRole("button", { name: "Disable Review" }),
    )

    await waitFor(() => {
      expect(disableStrategy).toHaveBeenCalledWith({ popupId: "popup-1" })
    })
  })

  it("does not interpret a GET 404 as an implicit auto-accept state", async () => {
    getStrategy.mockRejectedValue({ status: 404 })

    render(<ApprovalStrategyForm popupId="popup-1" />, { wrapper: wrapper() })

    expect(
      await screen.findByText("Approval strategy could not be loaded"),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Enable Application Review" }),
    ).toBeNull()
  })
})
