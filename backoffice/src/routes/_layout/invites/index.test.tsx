import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listInvites: vi.fn(),
  setPagination: vi.fn(),
}))

vi.mock("@/client", () => ({
  InvitesService: { listInvites: mocks.listInvites },
}))

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({ useSearch: () => ({}) }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock("@/components/Common/DataTable", () => ({
  DataTable: () => <div data-testid="links-table" />,
  SortableHeader: () => null,
}))

vi.mock("@/hooks/useTableSearchParams", () => ({
  useTableSearchParams: () => ({
    pagination: { pageIndex: 4, pageSize: 20 },
    setPagination: mocks.setPagination,
  }),
  validateTableSearch: () => ({}),
}))

import {
  getInvitesQueryOptions,
  InvitesTableContent,
  resetPaginationForIssuerChange,
} from "./index"

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("invites list query", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listInvites.mockResolvedValue({
      results: [],
      paging: { limit: 20, offset: 0, total: 0 },
    })
  })

  it("requests all links by default and includes the issuer in the query key", async () => {
    const options = getInvitesQueryOptions("popup-1", 2, 20)

    await options.queryFn()

    expect(mocks.listInvites).toHaveBeenCalledWith({
      popupId: "popup-1",
      issuer: "all",
      skip: 40,
      limit: 20,
    })
    expect(options.queryKey).toEqual([
      "invites",
      { popupId: "popup-1", page: 2, pageSize: 20, issuer: "all" },
    ])
  })

  it.each([
    "all",
    "admin",
    "portal",
  ] as const)("passes the %s issuer filter to the API", async (issuer) => {
    await getInvitesQueryOptions("popup-1", 0, 50, issuer).queryFn()

    expect(mocks.listInvites).toHaveBeenCalledWith({
      popupId: "popup-1",
      issuer,
      skip: 0,
      limit: 50,
    })
  })

  it("resets pagination when the issuer changes", () => {
    expect(
      resetPaginationForIssuerChange({ pageIndex: 4, pageSize: 25 }),
    ).toEqual({ pageIndex: 0, pageSize: 25 })
  })

  it("resets the active table page before loading another issuer", async () => {
    const user = userEvent.setup()
    render(<InvitesTableContent popupId="popup-1" />, { wrapper: Wrapper })

    await user.click(
      await screen.findByRole("button", { name: "Shared by attendees" }),
    )

    expect(mocks.setPagination).toHaveBeenCalledWith({
      pageIndex: 0,
      pageSize: 20,
    })
    await waitFor(() =>
      expect(mocks.listInvites).toHaveBeenLastCalledWith(
        expect.objectContaining({ issuer: "portal", skip: 0 }),
      ),
    )
  })
})
