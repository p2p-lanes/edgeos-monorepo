import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  FormFieldsService,
  FormSectionsService,
  SalesFlowsService,
  TicketingStepsService,
} from "@/client"
import { prefetchFlowEditor } from "@/lib/flowEditorPrefetch"
import {
  allFormFieldsQueryOptions,
  allFormSectionsQueryOptions,
  salesFlowsQueryKey,
  salesFlowsQueryOptions,
  ticketingStepsQueryOptions,
} from "@/lib/salesFlowQueries"
import { useFlowEditorPrefetch } from "./useFlowEditorPrefetch"
import { rememberFlow, useFlowScope } from "./useFlowScope"

const state = vi.hoisted(() => ({
  workspace: {
    selectedPopupId: "popup-a",
    effectiveTenantId: "tenant-a",
    isContextReady: true,
  },
  user: { id: "user", role: "admin", tenant_id: "tenant-a" },
}))
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => state.workspace,
}))
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useAuth")>()
  return {
    ...actual,
    default: () => ({
      user: state.user,
      isOperatorOrAbove: actual.isOperatorOrAbove(state.user as never),
    }),
  }
})

const flows = [
  {
    id: "default",
    popup_id: "popup-a",
    tenant_id: "tenant-a",
    is_default: true,
  },
  {
    id: "chosen",
    popup_id: "popup-a",
    tenant_id: "tenant-a",
    is_default: false,
  },
]
function listed(results = flows) {
  return {
    results,
    paging: { offset: 0, limit: 100, total: results.length },
  } as never
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let client: QueryClient
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.restoreAllMocks()
  const storage = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
  localStorage.setItem("access_token", "test-token")
  localStorage.setItem("workspace_tenant_id", "tenant-a")
  localStorage.setItem("workspace_popup_id", "popup-a")
  state.workspace = {
    selectedPopupId: "popup-a",
    effectiveTenantId: "tenant-a",
    isContextReady: true,
  }
  state.user = { id: "user", role: "admin", tenant_id: "tenant-a" }
  // Match the application's existing global default, not an increased prefetch freshness window.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  vi.spyOn(SalesFlowsService, "listSalesFlows").mockResolvedValue(listed())
  vi.spyOn(TicketingStepsService, "listTicketingSteps").mockResolvedValue({
    results: [{ id: "step" }],
  } as never)
  vi.spyOn(FormFieldsService, "listFormFields").mockResolvedValue({
    results: [{ id: "field" }],
  } as never)
  vi.spyOn(FormSectionsService, "listFormSections").mockResolvedValue({
    results: [{ id: "section" }],
  } as never)
})

describe("flow editor navigation intent", () => {
  it("reuses the warmed list and scoped steps when the real flow-scope consumer mounts", async () => {
    const { result } = renderHook(
      () => {
        const { scope } = useFlowEditorPrefetch()
        useQuery({
          ...salesFlowsQueryOptions("popup-a", scope),
          enabled: !!scope,
        })
        return scope
      },
      { wrapper: Wrapper },
    )
    await waitFor(() =>
      expect(client.getQueryData(salesFlowsQueryKey("popup-a"))).toBeDefined(),
    )
    await act(async () => {
      await Promise.all([
        prefetchFlowEditor(
          client,
          result.current,
          "/ticketing-steps",
          "chosen",
        ),
        prefetchFlowEditor(
          client,
          result.current,
          "/ticketing-steps",
          "chosen",
        ),
      ])
    })
    const page = renderHook(
      () => {
        const flow = useFlowScope(
          "popup-a",
          "chosen",
          undefined,
          result.current,
        )
        return useQuery({
          ...ticketingStepsQueryOptions(
            "popup-a",
            flow.activeFlowId,
            result.current,
          ),
          enabled: !!flow.activeFlowId,
        })
      },
      { wrapper: Wrapper },
    )
    expect(page.result.current.data?.results[0].id).toBe("step")
    expect(page.result.current.isLoading).toBe(false)
    expect(SalesFlowsService.listSalesFlows).toHaveBeenCalledTimes(1)
    expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledTimes(1)
    expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledWith({
      popupId: "popup-a",
      salesFlowId: "chosen",
      limit: 100,
      xTenantId: "tenant-a",
    })
  })

  it("loads fields and sections in parallel and reuses both exact consumer keys", async () => {
    const fields = deferred<never>()
    const sections = deferred<never>()
    vi.mocked(FormFieldsService.listFormFields).mockReturnValue(
      fields.promise as never,
    )
    vi.mocked(FormSectionsService.listFormSections).mockReturnValue(
      sections.promise as never,
    )
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    const intent = prefetchFlowEditor(
      client,
      result.current.scope,
      "/form-builder",
      "chosen",
    )
    await waitFor(() =>
      expect(FormFieldsService.listFormFields).toHaveBeenCalledOnce(),
    )
    expect(FormSectionsService.listFormSections).toHaveBeenCalledOnce()
    fields.resolve({ results: [{ id: "field" }] } as never)
    sections.resolve({ results: [{ id: "section" }] } as never)
    await intent
    const page = renderHook(
      () => ({
        fields: useQuery(
          allFormFieldsQueryOptions("popup-a", "chosen", result.current.scope),
        ),
        sections: useQuery(
          allFormSectionsQueryOptions(
            "popup-a",
            "chosen",
            result.current.scope,
          ),
        ),
      }),
      { wrapper: Wrapper },
    )
    expect(page.result.current.fields.data?.results[0].id).toBe("field")
    expect(page.result.current.sections.data?.results[0].id).toBe("section")
    expect(FormFieldsService.listFormFields).toHaveBeenCalledOnce()
    expect(FormSectionsService.listFormSections).toHaveBeenCalledOnce()
  })

  it("uses the existing remembered/default policy only for unnamed sidebar links", async () => {
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    rememberFlow("popup-a", "chosen")
    await prefetchFlowEditor(client, result.current.scope, "/ticketing-steps")
    expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "chosen" }),
    )
  })

  it.each([
    "missing",
    "foreign-popup",
    "foreign-tenant",
  ])("does not load scoped resources for %s", async (flowId) => {
    vi.mocked(SalesFlowsService.listSalesFlows).mockResolvedValue(
      listed([
        ...flows,
        {
          id: "foreign-popup",
          popup_id: "popup-b",
          tenant_id: "tenant-a",
          is_default: false,
        },
        {
          id: "foreign-tenant",
          popup_id: "popup-a",
          tenant_id: "tenant-b",
          is_default: false,
        },
      ]),
    )
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    await prefetchFlowEditor(
      client,
      result.current.scope,
      "/ticketing-steps",
      flowId,
    )
    expect(TicketingStepsService.listTicketingSteps).not.toHaveBeenCalled()
  })

  it("rejects a destination from a different selected popup before requesting a list", async () => {
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    await prefetchFlowEditor(
      client,
      result.current.scope,
      "/form-builder",
      "chosen",
      "popup-b",
    )
    expect(SalesFlowsService.listSalesFlows).not.toHaveBeenCalled()
  })

  it("waits for stale missing-flow validation without prefetching the cached default", async () => {
    client.setQueryData(salesFlowsQueryKey("popup-a"), listed([flows[0]]), {
      updatedAt: 1,
    })
    const pending = deferred<never>()
    vi.mocked(SalesFlowsService.listSalesFlows).mockReturnValue(
      pending.promise as never,
    )
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    const intent = prefetchFlowEditor(
      client,
      result.current.scope,
      "/ticketing-steps",
      "chosen",
    )
    expect(TicketingStepsService.listTicketingSteps).not.toHaveBeenCalled()
    pending.resolve(listed())
    await intent
    expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "chosen" }),
    )
  })

  it.each([
    "list",
    "resource",
  ])("discards a late %s response after a tenant switch", async (stage) => {
    const pending = deferred<never>()
    if (stage === "list")
      vi.mocked(SalesFlowsService.listSalesFlows).mockReturnValue(
        pending.promise as never,
      )
    else
      vi.mocked(TicketingStepsService.listTicketingSteps).mockReturnValue(
        pending.promise as never,
      )
    const hook = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    const intent = prefetchFlowEditor(
      client,
      hook.result.current.scope,
      "/ticketing-steps",
      "chosen",
    )
    if (stage === "resource")
      await waitFor(() =>
        expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledOnce(),
      )
    localStorage.setItem("workspace_tenant_id", "tenant-b")
    localStorage.setItem("workspace_popup_id", "popup-b")
    state.workspace = {
      selectedPopupId: "popup-b",
      effectiveTenantId: "tenant-b",
      isContextReady: true,
    }
    hook.rerender()
    pending.resolve(
      stage === "list"
        ? listed()
        : ({ results: [{ id: "old-step" }] } as never),
    )
    await intent
    expect(
      client.getQueryData(
        ticketingStepsQueryOptions("popup-a", "chosen").queryKey,
      ),
    ).toBeUndefined()
    if (stage === "list") {
      expect(client.getQueryData(salesFlowsQueryKey("popup-a"))).toBeUndefined()
      expect(TicketingStepsService.listTicketingSteps).not.toHaveBeenCalled()
    } else {
      expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledTimes(1)
      expect(TicketingStepsService.listTicketingSteps).toHaveBeenCalledWith(
        expect.objectContaining({ xTenantId: "tenant-a" }),
      )
    }
  })

  it.each([
    "viewer",
    "check_in_controller",
  ])("does not prefetch editor data for %s", async (role) => {
    state.user.role = role
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    await prefetchFlowEditor(
      client,
      result.current.scope,
      "/ticketing-steps",
      "chosen",
    )
    expect(SalesFlowsService.listSalesFlows).not.toHaveBeenCalled()
  })

  it.each([
    "admin",
    "operator",
    "superadmin",
  ])("warms the workspace list for an authorized %s", async (role) => {
    state.user.role = role
    renderHook(
      () => {
        const { scope } = useFlowEditorPrefetch()
        return useQuery({
          ...salesFlowsQueryOptions("popup-a", scope),
          enabled: !!scope,
        })
      },
      { wrapper: Wrapper },
    )
    await waitFor(() =>
      expect(SalesFlowsService.listSalesFlows).toHaveBeenCalledOnce(),
    )
    expect(TicketingStepsService.listTicketingSteps).not.toHaveBeenCalled()
    expect(FormFieldsService.listFormFields).not.toHaveBeenCalled()
  })

  it("does not warm flows before the authenticated workspace is ready", () => {
    state.workspace.isContextReady = false
    renderHook(
      () => {
        const { scope } = useFlowEditorPrefetch()
        return useQuery({
          ...salesFlowsQueryOptions("popup-a", scope),
          enabled: !!scope,
        })
      },
      { wrapper: Wrapper },
    )
    expect(SalesFlowsService.listSalesFlows).not.toHaveBeenCalled()
  })

  it("does not start a late intent after logout or an ambient scope change before React renders", async () => {
    const { result } = renderHook(useFlowEditorPrefetch, { wrapper: Wrapper })
    localStorage.removeItem("access_token")
    await prefetchFlowEditor(
      client,
      result.current.scope,
      "/ticketing-steps",
      "chosen",
    )
    expect(SalesFlowsService.listSalesFlows).not.toHaveBeenCalled()
  })
})
