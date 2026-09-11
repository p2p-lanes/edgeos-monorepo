import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  getRelevantApplication: vi.fn(),
  schemaHook: vi.fn(),
  schemaRequest: vi.fn(),
  dynamicForm: vi.fn(),
  applications: [] as Array<Record<string, unknown>>,
  applicationsQueryState: {
    isPending: false,
    isFetching: false,
    isFetchedAfterMount: true,
    isLoadingError: false,
  },
  flowIdentifier: "flow-a" as string | null,
  checkoutSuccess: false,
  portalFlows: undefined as
    | Array<{ id: string; slug: string; name: string }>
    | undefined,
  flowState: {
    isPending: false,
    isFetching: false,
    isFetchedAfterMount: true,
    isLoadingError: false,
  },
  schemaResult: {
    data: {
      base_fields: {},
      custom_fields: {},
      sections: [],
    },
    isPending: false,
    isLoadingError: false,
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => {
    const params = new URLSearchParams()
    if (mocks.flowIdentifier) params.set("flow", mocks.flowIdentifier)
    if (mocks.checkoutSuccess) params.set("checkout", "success")
    return params
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@edgeos/shared-form-ui", () => ({
  FileUploadProvider: ({ children }: { children: ReactNode }) => children,
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
    applications: mocks.applications,
    getRelevantApplication: mocks.getRelevantApplication,
  }),
}))

vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => mocks.applicationsQueryState,
}))

vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: mocks.portalFlows, ...mocks.flowState }),
}))

vi.mock("@/hooks/useApplicationSchema", () => ({
  useApplicationSchema: (popupId: string, flowId: string | null) => {
    mocks.schemaHook(popupId, flowId)
    if (flowId) mocks.schemaRequest(flowId)
    return mocks.schemaResult
  },
}))

vi.mock("../events/lib/useFileUpload", () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() }),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

vi.mock("./components/dynamic-application-form", () => ({
  DynamicApplicationForm: (props: {
    salesFlowId: string
    existingApplication?: Record<string, unknown> | null
  }) => {
    mocks.dynamicForm(props)
    return <div data-testid="application-form" />
  },
}))

vi.mock("./components/form-header", () => ({
  FormHeader: () => <div data-testid="form-header" />,
}))

vi.mock("./components/section-separator", () => ({
  SectionSeparator: () => null,
}))

import FormPage from "./page"

const MULTI_FLOWS = [
  { id: "flow-a", slug: "attendee", name: "Attendee" },
  { id: "flow-b", slug: "volunteers", name: "Volunteers" },
]

describe("application flow routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.flowIdentifier = "flow-a"
    mocks.checkoutSuccess = false
    mocks.portalFlows = MULTI_FLOWS
    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.flowState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    const application = {
      id: "application-a",
      popup_id: "popup-1",
      sales_flow_id: "flow-a",
      status: "draft",
    }
    mocks.applications = [application]
    mocks.getRelevantApplication.mockReturnValue(application)
  })

  it("holds the form on the canonical loader while flow discovery is unresolved", () => {
    mocks.portalFlows = undefined
    mocks.flowState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }

    render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("application-form")).toBeNull()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", null)
  })

  it("renders the existing application error treatment after flow query failure", () => {
    mocks.portalFlows = undefined
    mocks.flowState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: true,
    }

    render(<FormPage />)

    expect(screen.getByText("application.unavailable")).toBeTruthy()
    expect(screen.queryByTestId("loader")).toBeNull()
    expect(screen.queryByTestId("application-form")).toBeNull()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it.each([
    "pending_fee",
    "in review",
    "accepted",
  ])("forwards legacy fee-success links to the overview when the application is %s", (status) => {
    mocks.checkoutSuccess = true
    mocks.getRelevantApplication.mockReturnValue({
      id: "application-a",
      sales_flow_id: "flow-a",
      status,
    })

    render(<FormPage />)

    expect(mocks.replace).toHaveBeenCalledWith(
      "/portal/gathering?flow=flow-a&checkout=success",
    )
    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("application-form")).toBeNull()
  })

  it("renders the selected-flow form without the redundant chooser panel", () => {
    render(<FormPage />)

    expect(screen.getByTestId("application-form")).toBeTruthy()
    expect(screen.queryByText("Choose how you'd like to apply")).toBeNull()
    expect(
      screen.queryByText(
        "This event has more than one application track. Select one to continue.",
      ),
    ).toBeNull()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", "flow-a")
    expect(mocks.dynamicForm).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-a" }),
    )
  })

  it("preserves the single-flow form route without requiring a flow query", () => {
    mocks.flowIdentifier = null
    mocks.portalFlows = [MULTI_FLOWS[0]]

    render(<FormPage />)

    expect(screen.getByTestId("application-form")).toBeTruthy()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", "flow-a")
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it("waits for applications before choosing between a draft and a new form", () => {
    mocks.applications = []
    mocks.applicationsQueryState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }
    mocks.getRelevantApplication.mockReturnValue(null)

    const { rerender } = render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(mocks.dynamicForm).not.toHaveBeenCalled()

    const draft = {
      id: "application-a",
      popup_id: "popup-1",
      sales_flow_id: "flow-a",
      status: "draft",
    }
    mocks.applications = [draft]
    mocks.applicationsQueryState = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isLoadingError: false,
    }
    mocks.getRelevantApplication.mockReturnValue(draft)
    rerender(<FormPage />)

    expect(screen.getByTestId("application-form")).toBeTruthy()
    expect(mocks.dynamicForm).toHaveBeenCalledWith(
      expect.objectContaining({ existingApplication: draft }),
    )
  })

  it("waits for a stale flow refresh on mount without loading on later refetches", () => {
    mocks.flowState = {
      isPending: false,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }

    const { rerender } = render(<FormPage />)
    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(mocks.dynamicForm).not.toHaveBeenCalled()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", null)
    expect(mocks.schemaRequest).not.toHaveBeenCalled()

    mocks.flowState = { ...mocks.flowState, isFetchedAfterMount: true }
    rerender(<FormPage />)

    expect(screen.getByTestId("application-form")).toBeTruthy()
    expect(mocks.schemaRequest).toHaveBeenCalledWith("flow-a")
  })

  it("does not auto-select a cached single flow before it refreshes to multiple flows", async () => {
    mocks.flowIdentifier = null
    mocks.portalFlows = [MULTI_FLOWS[0]]
    mocks.flowState = {
      isPending: false,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }

    const { rerender } = render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", null)
    expect(mocks.schemaRequest).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()

    mocks.portalFlows = MULTI_FLOWS
    mocks.flowState = {
      ...mocks.flowState,
      isFetching: false,
      isFetchedAfterMount: true,
    }
    rerender(<FormPage />)

    expect(mocks.schemaRequest).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/portal/gathering"),
    )
  })

  it("waits for refreshed flows before resolving a newly added selected flow", () => {
    mocks.flowIdentifier = "flow-b"
    mocks.portalFlows = [MULTI_FLOWS[0]]
    mocks.flowState = {
      isPending: false,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }

    const { rerender } = render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(mocks.schemaHook).toHaveBeenCalledWith("popup-1", null)
    expect(mocks.schemaRequest).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()

    mocks.portalFlows = MULTI_FLOWS
    mocks.flowState = {
      ...mocks.flowState,
      isFetching: false,
      isFetchedAfterMount: true,
    }
    mocks.getRelevantApplication.mockReturnValue(null)
    rerender(<FormPage />)

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.schemaRequest).toHaveBeenCalledTimes(1)
    expect(mocks.schemaRequest).toHaveBeenCalledWith("flow-b")
    expect(mocks.schemaRequest).not.toHaveBeenCalledWith("flow-a")
    expect(mocks.dynamicForm).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-b" }),
    )
  })

  it("returns a missing multi-flow selection to the application overview", async () => {
    mocks.flowIdentifier = null

    render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("application-form")).toBeNull()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/portal/gathering"),
    )
  })

  it("returns an invalid flow selection to the application overview", async () => {
    mocks.flowIdentifier = "unknown-flow"

    render(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("application-form")).toBeNull()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/portal/gathering"),
    )
  })

  it("does not reuse flow A while an in-place flow B request resolves", () => {
    const { rerender } = render(<FormPage />)

    mocks.getRelevantApplication.mockClear()
    mocks.flowIdentifier = "flow-b"
    mocks.portalFlows = undefined
    mocks.flowState = {
      isPending: true,
      isFetching: true,
      isFetchedAfterMount: false,
      isLoadingError: false,
    }
    rerender(<FormPage />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(mocks.getRelevantApplication).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
