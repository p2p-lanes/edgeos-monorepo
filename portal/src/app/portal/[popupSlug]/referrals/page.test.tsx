import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createMyLink: vi.fn(),
  deleteMyLink: vi.fn(),
  toastError: vi.fn(),
  invalidateQueries: vi.fn(),
  canShare: true,
  hasCrossLink: false,
  crossLinkUses: 0,
  includeSingleFlowPopup: false,
  onlyOneFlow: false,
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[1] === "sharing") {
      return {
        data: { can_share: mocks.canShare, sales_flow_id: "source-flow" },
        isLoading: false,
      }
    }
    if (queryKey[1] === "mine") {
      return { data: { results: [] }, isLoading: false }
    }
    return {
      data: [
        {
          popup_id: "popup-b",
          sales_flow_id: "flow-general",
          flow_name: "General",
          name: "Another event",
          slug: "another-event",
          link: null,
        },
        {
          popup_id: "popup-b",
          sales_flow_id: "flow-volunteers",
          flow_name: "Volunteers",
          name: "Another event",
          slug: "another-event",
          link: mocks.hasCrossLink
            ? {
                id: "link-volunteers",
                token: "volunteers-code",
                discount_percentage: "0",
                current_uses: mocks.crossLinkUses,
              }
            : null,
        },
      ]
        .filter(
          (target) =>
            !mocks.onlyOneFlow || target.sales_flow_id === "flow-general",
        )
        .concat(
          mocks.includeSingleFlowPopup
            ? [
                {
                  popup_id: "popup-c",
                  sales_flow_id: "flow-only",
                  flow_name: "Only door",
                  name: "A solo event",
                  slug: "a-solo-event",
                  link: null,
                },
              ]
            : [],
        ),
      isLoading: false,
    }
  },
  useMutation: (options: {
    mutationFn: (arg: unknown) => unknown
    onSuccess?: () => void
    onError?: (error: unknown) => void
  }) => ({
    mutate: (arg: unknown) => {
      Promise.resolve(options.mutationFn(arg)).then(
        () => options.onSuccess?.(),
        (error) => options.onError?.(error),
      )
    },
    isPending: false,
  }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span role="tooltip">{children}</span>
  ),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-a" }) }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}))
vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(
      _request: unknown,
      response: { status: number },
      message: string,
    ) {
      super(message)
      this.status = response.status
    }
  },
  InvitesService: {
    getMySharingStatus: vi.fn(),
    listMyLinks: vi.fn(),
    listCrossPopupTargets: vi.fn(),
    createMyLink: mocks.createMyLink,
    deleteMyLink: mocks.deleteMyLink,
  },
}))

import { ApiError } from "@/client"
import ReferralsPage from "./page"

describe("cross-popup referrals page", () => {
  beforeEach(() => {
    mocks.canShare = true
    mocks.hasCrossLink = false
    mocks.crossLinkUses = 0
    mocks.includeSingleFlowPopup = false
    mocks.onlyOneFlow = false
    mocks.createMyLink.mockReset()
    mocks.deleteMyLink.mockReset()
    mocks.toastError.mockReset()
    mocks.invalidateQueries.mockReset()
  })

  it("offers every eligible destination flow even without a purchased product", () => {
    render(<ReferralsPage />)
    expect(screen.getByText("General")).toBeTruthy()
    const flowName = screen.getByText("Volunteers")
    expect(flowName.parentElement?.textContent).toContain(
      "Another event · Volunteers",
    )
    expect(flowName.classList.contains("font-semibold")).toBe(true)

    fireEvent.click(
      screen.getAllByRole("button", { name: "referrals.cross_create" })[1],
    )
    expect(mocks.createMyLink).toHaveBeenCalledWith({
      requestBody: {
        popup_id: "popup-b",
        source_popup_id: "popup-a",
        sales_flow_id: "flow-volunteers",
      },
    })
  })

  it("shows the flow only for gatherings with multiple eligible options", () => {
    mocks.includeSingleFlowPopup = true
    render(<ReferralsPage />)

    const singleName = screen.getByText("A solo event")
    expect(singleName.parentElement?.textContent).toBe("A solo event")
    expect(screen.queryByText("Only door")).toBeNull()
    expect(singleName.classList.contains("font-semibold")).toBe(true)
    expect(screen.getByText("Volunteers")).toBeTruthy()
  })

  it("omits the flow when it is the only eligible option overall", () => {
    mocks.onlyOneFlow = true
    render(<ReferralsPage />)
    expect(screen.getByText("Another event").parentElement?.textContent).toBe(
      "Another event",
    )
    expect(screen.queryByText("General")).toBeNull()
  })

  it("labels a cross-popup link with no discount correctly", () => {
    mocks.hasCrossLink = true
    render(<ReferralsPage />)
    expect(screen.getByText("volunteers-code")).toBeTruthy()
    expect(
      screen.getByText(
        /referrals.discount_label: referrals.preview_no_discount/,
      ),
    ).toBeTruthy()
    expect(
      screen.getAllByRole("button", { name: "referrals.cross_create" }),
    ).toHaveLength(1)
  })

  it("disables deletion and explains why when a referral link has been used", () => {
    mocks.hasCrossLink = true
    mocks.crossLinkUses = 2
    render(<ReferralsPage />)

    const deleteButton = screen.getByRole("button", {
      name: "referrals.delete_referral",
    }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(true)
    expect(
      document.getElementById(
        deleteButton.getAttribute("aria-describedby") ?? "",
      )?.textContent,
    ).toBe("referrals.delete_used_explanation")
    expect(screen.getByRole("tooltip").textContent).toBe(
      "referrals.delete_used_explanation",
    )
    expect(screen.queryByText("referrals.delete_confirm_title")).toBeNull()
  })

  it("still allows deleting a referral link with no uses", () => {
    mocks.hasCrossLink = true
    render(<ReferralsPage />)
    const deleteButton = screen.getByRole("button", {
      name: "referrals.delete_referral",
    }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(false)
  })

  it("explains a 409 and refreshes the link if it was used after loading", async () => {
    mocks.hasCrossLink = true
    mocks.deleteMyLink.mockRejectedValueOnce(
      new ApiError({} as never, { status: 409 } as never, "used"),
    )
    render(<ReferralsPage />)

    fireEvent.click(
      screen.getByRole("button", { name: "referrals.delete_referral" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "referrals.delete_confirm" }),
    )

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "referrals.delete_used_explanation",
      )
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["referrals", "cross-targets", "popup-a"],
    })
    expect(screen.queryByText("referrals.delete_confirm_title")).toBeNull()
  })

  it("does not offer links when the backend denies sharing", () => {
    mocks.canShare = false
    render(<ReferralsPage />)
    expect(screen.getByText("referrals.sharing_unavailable")).toBeTruthy()
    expect(screen.queryByText("Volunteers")).toBeNull()
  })
})
