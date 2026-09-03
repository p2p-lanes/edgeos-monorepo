import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import GroupCheckoutPage from "./page"

const mocks = vi.hoisted(() => ({
  group: {
    id: "group-1",
    popup_id: "popup-1",
    sales_flow_id: "flow-group",
    discount_percentage: 0,
    auto_approve_applications: false,
  },
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupSlug: "group-slug" }),
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  InvitesService: { previewInvite: vi.fn() },
  PortalService: { resolveGroupSlug: vi.fn() },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "group-slug-resolution"
      ? { data: { kind: "group" } }
      : { data: undefined, isLoading: false },
}))

vi.mock("@/hooks/useGetPublicGroup", () => ({
  default: () => ({ group: mocks.group, loading: false, error: null }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1" }),
    getPopups: () => [
      {
        id: "popup-1",
        slug: "popup-slug",
        name: "Popup",
        sale_type: "application",
      },
    ],
    popupsLoaded: true,
    setCityPreselected: vi.fn(),
  }),
}))

vi.mock("@/providers/discountProvider", () => ({
  useDiscount: () => ({
    setDiscount: vi.fn(),
    discountApplied: {
      city_id: "popup-1",
      discount_value: 0,
    },
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/lib/background-image", () => ({
  getCheckoutBackground: () => ({ type: "none" }),
}))

vi.mock("@/app/checkout/components/PopupCheckoutContent", () => ({
  PopupCheckoutContent: ({
    requiresManualApproval,
    salesFlowId,
  }: {
    requiresManualApproval?: boolean
    salesFlowId?: string | null
  }) => (
    <div>{`requires-manual-approval:${String(requiresManualApproval)};flow:${salesFlowId}`}</div>
  ),
}))

describe("GroupCheckoutPage approval policy", () => {
  beforeEach(() => {
    mocks.group.auto_approve_applications = false
  })

  it("uses the pending-review checkout state for a manual-approval group", () => {
    render(<GroupCheckoutPage />)

    expect(
      screen.getByText("requires-manual-approval:true;flow:flow-group"),
    ).toBeTruthy()
  })

  it("keeps checkout available for an auto-approved group", () => {
    mocks.group.auto_approve_applications = true

    render(<GroupCheckoutPage />)

    expect(
      screen.getByText("requires-manual-approval:false;flow:flow-group"),
    ).toBeTruthy()
  })
})
