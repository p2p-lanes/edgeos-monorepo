import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApplicationsService } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { useSubmitApplication } from "./use-submit-application"

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  ApplicationsService: {
    updateMyApplication: vi
      .fn()
      .mockResolvedValue({ id: "app-1", status: "draft" }),
    createMyApplication: vi
      .fn()
      .mockResolvedValue({ id: "app-2", status: "draft" }),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/hooks/useApplicationFee", () => ({
  useApplicationFee: () => ({ createOrResume: vi.fn(), isPending: false }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ updateApplication: vi.fn() }),
}))

describe("useSubmitApplication create-vs-update (rel-001 correction)", () => {
  const schema: ApplicationFormSchema = {
    base_fields: {},
    custom_fields: {},
    sections: [],
  }
  const popup = { id: "popup-1" } as PopupPublic

  beforeEach(() => vi.clearAllMocks())

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }

  it("updates an unambiguous application using its sales flow", async () => {
    const existing = {
      id: "app-1",
      sales_flow_id: "flow-a",
    } as ApplicationPublic
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: existing,
          validate: () => ({ isValid: true, errors: {} }),
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.updateMyApplication).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-a" }),
    )
    expect(ApplicationsService.createMyApplication).not.toHaveBeenCalled()
  })

  it("creates when this door has no application yet", async () => {
    /* The caller resolves `application` for the door being submitted for
       (sdd/sales-flows-rediseno), so null means this door genuinely has
       none — not that another door's is in hand.

       This used to create whenever the gathering had more than one flow,
       even with a draft open, because `application` was popup-scoped and
       could not be proven to belong here. That trade would now break
       editing: the backend's per-human-per-flow guard refuses the second
       application. */
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: null,
          validate: () => ({ isValid: true, errors: {} }),
          salesFlowId: "flow-b",
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.createMyApplication).toHaveBeenCalled()
    expect(ApplicationsService.updateMyApplication).not.toHaveBeenCalled()
  })

  it("edits this door's own draft instead of opening a second one", async () => {
    const applications = [
      { id: "app-1", sales_flow_id: "flow-a" },
      { id: "app-2", sales_flow_id: "flow-b" },
    ] as ApplicationPublic[]
    const existing = applications[1]
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: existing,
          validate: () => ({ isValid: true, errors: {} }),
          salesFlowId: "flow-b",
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.updateMyApplication).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-b" }),
    )
    expect(ApplicationsService.createMyApplication).not.toHaveBeenCalled()
  })
})
