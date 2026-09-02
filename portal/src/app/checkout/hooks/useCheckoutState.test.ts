import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { vi } from "vitest"
import { ApiError, type ApplicationPublic, ApplicationsService } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import useCheckoutState, {
  buildCheckoutApplicationMutationPayload,
  findCheckoutApplication,
  readCheckoutSubmitError,
  upsertCheckoutApplication,
} from "./useCheckoutState"

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {
    body: unknown
    status: number

    constructor(
      _request: unknown,
      response: { body: unknown; status: number },
      message: string,
    ) {
      super(message)
      this.body = response.body
      this.status = response.status
    }
  },
  ApplicationsService: {
    createMyApplication: vi.fn(),
    listMyApplications: vi.fn(),
    updateMyApplication: vi.fn(),
  },
  HumansService: {},
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

vi.mock("./useCookies", () => ({
  default: () => ({ getCookie: vi.fn(), setCookie: vi.fn() }),
}))

const schema: ApplicationFormSchema = {
  base_fields: {
    first_name: {
      type: "text",
      label: "First name",
      required: true,
      target: "human",
    },
    scholarship_request: {
      type: "boolean",
      label: "Scholarship",
      required: false,
      target: "application",
    },
  },
  custom_fields: {
    favorite_color: {
      type: "text",
      label: "Favorite color",
      required: false,
    },
  },
  sections: [],
}

function makeApiError(status: number, body: unknown): ApiError {
  return new ApiError(
    { method: "POST", url: "/api/v1/applications/my" },
    { url: "/api/v1/applications/my", ok: false, status, statusText: "", body },
    "request failed",
  )
}

describe("readCheckoutSubmitError", () => {
  it("surfaces field errors from a validation 400 instead of swallowing them", () => {
    // Regression: this shape used to be dropped, so a missing custom field
    // was reported to the applicant as "you already have an application".
    expect(
      readCheckoutSubmitError(
        makeApiError(400, {
          detail: {
            message: "Invalid custom fields",
            errors: ["Required field 'T-Shirt Size' is missing"],
          },
        }),
      ),
    ).toEqual({
      isDuplicate: false,
      detailText:
        "Invalid custom fields: Required field 'T-Shirt Size' is missing",
    })
  })

  it("flags a genuine duplicate from the detail string", () => {
    expect(
      readCheckoutSubmitError(
        makeApiError(400, { detail: "You already have an application" }),
      ),
    ).toEqual({
      isDuplicate: true,
      detailText: "You already have an application",
    })
  })

  it("flags any 409 as a duplicate", () => {
    expect(readCheckoutSubmitError(makeApiError(409, {})).isDuplicate).toBe(
      true,
    )
  })

  it("reports nothing usable for a non-API error", () => {
    expect(readCheckoutSubmitError(new Error("boom"))).toEqual({
      isDuplicate: false,
      detailText: null,
    })
  })
})

describe("buildCheckoutApplicationMutationPayload", () => {
  it("builds create payloads from checkout-visible base and custom fields", () => {
    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: true,
          custom_favorite_color: "Blue",
          gender_specify: "ignored",
        },
        existingApplication: null,
      }),
    ).toEqual({
      kind: "create",
      payload: {
        popup_id: "popup-1",
        first_name: "Matias",
        last_name: "",
        custom_fields: {
          favorite_color: "Blue",
        },
        status: "in review",
      },
    })
  })

  it("includes the selected flow in create payloads", () => {
    const result = buildCheckoutApplicationMutationPayload({
      popupId: "popup-1",
      salesFlowId: "flow-selected",
      values: { first_name: "Taylor" },
      schema,
      existingApplication: null,
    })

    expect(result.kind).toBe("create")
    expect(result.payload).toEqual(
      expect.objectContaining({ sales_flow_id: "flow-selected" }),
    )
  })

  it("builds update payloads from checkout-visible base and custom fields", () => {
    const existingApplication = {
      id: "app-1",
      popup_id: "popup-1",
    } as ApplicationPublic

    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: false,
          custom_favorite_color: "Green",
        },
        existingApplication,
      }),
    ).toEqual({
      kind: "update",
      payload: {
        first_name: "Matias",
        custom_fields: {
          favorite_color: "Green",
        },
        status: "in review",
      },
    })
  })
})

describe("findCheckoutApplication", () => {
  it("does not select another application from the same popup", () => {
    const applications = [
      {
        id: "application-main",
        popup_id: "popup-1",
        sales_flow_id: "flow-main",
      },
      {
        id: "application-partner",
        popup_id: "popup-1",
        sales_flow_id: "flow-partner",
      },
    ] as ApplicationPublic[]

    expect(
      findCheckoutApplication(applications, "popup-1", "flow-partner")?.id,
    ).toBe("application-partner")
    expect(
      findCheckoutApplication(applications, "popup-1", "flow-missing"),
    ).toBeUndefined()
    expect(findCheckoutApplication(applications, "popup-1")).toBeUndefined()
  })
})

describe("upsertCheckoutApplication", () => {
  it("preserves applications from other flows", () => {
    const main = {
      id: "application-main",
      popup_id: "popup-1",
      sales_flow_id: "flow-main",
      status: "accepted",
    } as ApplicationPublic
    const partner = {
      id: "application-partner",
      popup_id: "popup-1",
      sales_flow_id: "flow-partner",
      status: "in review",
    } as ApplicationPublic

    expect(upsertCheckoutApplication([main], partner)).toEqual([partner, main])
    expect(
      upsertCheckoutApplication([main, partner], {
        ...partner,
        status: "accepted",
      }),
    ).toEqual([{ ...partner, status: "accepted" }, main])
  })
})

describe("useCheckoutState update flow identity", () => {
  function createQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    })
  }

  function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      )
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it("updates the application selected by sales flow when a popup has two applications", async () => {
    const queryClient = createQueryClient()
    const main = {
      id: "application-main",
      popup_id: "popup-1",
      sales_flow_id: "flow-main",
      status: "draft",
    } as ApplicationPublic
    const partner = {
      id: "application-partner",
      popup_id: "popup-1",
      sales_flow_id: "flow-partner",
      status: "draft",
    } as ApplicationPublic
    queryClient.setQueryData(["applications", "mine"], [main, partner])
    vi.mocked(ApplicationsService.updateMyApplication).mockResolvedValue(
      partner,
    )

    const { result } = renderHook(
      () =>
        useCheckoutState({
          popupId: "popup-1",
          saleType: "application",
          salesFlowId: "flow-partner",
          schema,
        }),
      { wrapper: createWrapper(queryClient) },
    )

    await act(async () => result.current.handleSubmit({}))

    expect(ApplicationsService.updateMyApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        popupId: "popup-1",
        salesFlowId: "flow-partner",
      }),
    )
  })

  it("uses the selected sales flow when joining a group as an applicant", async () => {
    const queryClient = createQueryClient()
    const partner = {
      id: "application-partner",
      popup_id: "popup-1",
      sales_flow_id: "flow-partner",
      status: "draft",
    } as ApplicationPublic
    vi.mocked(ApplicationsService.updateMyApplication).mockResolvedValue(
      partner,
    )

    const { result } = renderHook(
      () =>
        useCheckoutState({
          popupId: "popup-1",
          saleType: "application",
          groupId: "group-1",
          salesFlowId: "flow-partner",
          schema,
        }),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => result.current.joinGroupAsApplicant())

    await waitFor(() => {
      expect(ApplicationsService.updateMyApplication).toHaveBeenCalledWith({
        popupId: "popup-1",
        salesFlowId: "flow-partner",
        requestBody: { group_id: "group-1" },
      })
    })
  })
})
