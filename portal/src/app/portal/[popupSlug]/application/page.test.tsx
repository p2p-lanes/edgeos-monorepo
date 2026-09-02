import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  getRelevantApplication: vi.fn(),
  flowIdentifier: "flow-a",
  portalFlows: undefined as
    | Array<{ id: string; slug: string; name: string }>
    | undefined,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(`flow=${mocks.flowIdentifier}`),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-1",
      slug: "gathering",
      status: "active",
      takes_applications: true,
    }),
    getPopups: () => [],
  }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    applications: [
      {
        id: "application-a",
        popup_id: "popup-1",
        sales_flow_id: "flow-a",
        status: "accepted",
      },
    ],
    getRelevantApplication: mocks.getRelevantApplication,
  }),
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.portalFlows }),
}))

vi.mock("@/hooks/useApplicationSchema", () => ({
  useApplicationSchema: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
  }),
}))

vi.mock("../events/lib/useFileUpload", () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() }),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

import FormPage from "./page"

describe("application flow routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.flowIdentifier = "flow-a"
    mocks.portalFlows = [
      { id: "flow-a", slug: "application-a", name: "Application A" },
    ]
    mocks.getRelevantApplication.mockReturnValue({
      id: "application-a",
      popup_id: "popup-1",
      sales_flow_id: "flow-a",
      status: "accepted",
    })
  })

  it("drops resolved flow A while an in-place flow B request resolves", async () => {
    const { rerender } = render(<FormPage />)

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/portal/gathering/passes?flow=flow-a",
      ),
    )

    mocks.replace.mockClear()
    mocks.getRelevantApplication.mockClear()
    mocks.flowIdentifier = "flow-b"
    mocks.portalFlows = undefined
    rerender(<FormPage />)

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.getRelevantApplication).not.toHaveBeenCalled()
  })
})
