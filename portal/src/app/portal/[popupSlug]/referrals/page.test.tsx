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
  noTargets: false,
  popupStatus: "active",
  ownFlowName: null as string | null,
  ownLink: null as null | {
    id: string
    token: string
    discount_percentage: string
    current_uses: number
    max_uses?: number | null
    sales_flow_id: string
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[1] === "sharing") {
      return {
        data: {
          can_share: mocks.canShare,
          sales_flow_id: "source-flow",
          flow_name: mocks.ownFlowName,
        },
        isLoading: false,
      }
    }
    if (queryKey[1] === "mine") {
      return {
        data: { results: mocks.ownLink ? [mocks.ownLink] : [] },
        isLoading: false,
      }
    }
    if (mocks.noTargets) return { data: [], isLoading: false }
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
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
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
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-a",
      name: "This gathering",
      status: mocks.popupStatus,
    }),
  }),
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
    mocks.noTargets = false
    mocks.popupStatus = "active"
    mocks.ownFlowName = null
    mocks.ownLink = null
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
      screen.getAllByRole("button", { name: "referrals.create_link" })[2],
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

  it("shows a link as its URL and leaves out a discount it does not have", () => {
    mocks.hasCrossLink = true
    render(<ReferralsPage />)
    expect(screen.getByText(/\/r\/volunteers-code$/)).toBeTruthy()
    expect(screen.getByText('referrals.uses_count {"count":0}')).toBeTruthy()
    expect(screen.queryByText(/preview_discount_value/)).toBeNull()
    expect(
      screen.getAllByRole("button", { name: "referrals.create_link" }),
    ).toHaveLength(2)
  })

  it("offers this event as a destination named like the others", () => {
    render(<ReferralsPage />)
    expect(screen.getByText("This gathering").parentElement?.textContent).toBe(
      "This gathering",
    )

    fireEvent.click(
      screen.getAllByRole("button", { name: "referrals.create_link" })[0],
    )
    expect(mocks.createMyLink).toHaveBeenCalledWith({
      requestBody: { popup_id: "popup-a" },
    })
  })

  it("names this event's flow when the backend says it has several", () => {
    mocks.ownFlowName = "Builders"
    render(<ReferralsPage />)
    expect(screen.getByText("Builders").parentElement?.textContent).toContain(
      "This gathering · Builders",
    )
  })

  it("replaces Create with the link once this event has one", () => {
    mocks.ownLink = {
      id: "own",
      token: "own-code",
      discount_percentage: "15",
      current_uses: 2,
      max_uses: 10,
      sales_flow_id: "source-flow",
    }
    render(<ReferralsPage />)
    expect(screen.getByText(/\/r\/own-code$/)).toBeTruthy()
    expect(
      screen.getByText(
        'referrals.uses_of {"used":2,"max":10} · referrals.preview_discount_value {"percent":15}',
      ),
    ).toBeTruthy()
    // Only the two Tech-Summit-like destinations still offer Create.
    expect(
      screen.getAllByRole("button", { name: "referrals.create_link" }),
    ).toHaveLength(2)
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

  it("only offers links into other events once the popup has ended", () => {
    mocks.popupStatus = "ended"
    render(<ReferralsPage />)

    expect(screen.getByText("referrals.ended_description")).toBeTruthy()
    expect(screen.queryByText("This gathering")).toBeNull()
    expect(screen.getByText("Volunteers")).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole("button", { name: "referrals.create_link" })[0],
    )
    expect(mocks.createMyLink).toHaveBeenCalledWith({
      requestBody: {
        popup_id: "popup-b",
        source_popup_id: "popup-a",
        sales_flow_id: "flow-general",
      },
    })
  })

  it("says so when an ended popup has no other event to share", () => {
    mocks.popupStatus = "ended"
    mocks.noTargets = true
    render(<ReferralsPage />)
    expect(screen.getByText("referrals.ended_no_targets")).toBeTruthy()
  })
})
