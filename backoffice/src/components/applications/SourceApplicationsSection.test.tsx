import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SourceApplicationsSection } from "./SourceApplicationsSection"

const mocks = vi.hoisted(() => ({
  listApplications: vi.fn(),
}))

vi.mock("@/client", () => ({
  ApplicationsService: { listApplications: mocks.listApplications },
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: ReactNode
    params: { id: string }
  }) => <a href={`/applications/${params.id}`}>{children}</a>,
}))

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SourceApplicationsSection
        popupId="popup-1"
        source="invite"
        sourceId="invite-1"
      />
    </QueryClientProvider>,
  )
}

describe("SourceApplicationsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listApplications.mockResolvedValue({
      results: [
        {
          id: "application-1",
          status: "accepted",
          created_at: "2026-09-01T12:00:00Z",
          human: {
            first_name: "Ada",
            last_name: "Lovelace",
            email: "ada@example.com",
          },
        },
      ],
      paging: { total: 11, limit: 10, offset: 0 },
    })
  })

  it("lists attributed applicants using the exact invite filter", async () => {
    renderSection()

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/applications/application-1",
    )
    expect(mocks.listApplications).toHaveBeenCalledWith({
      popupId: "popup-1",
      filters: JSON.stringify({
        match: "all",
        conditions: [{ field: "invite_id", op: "eq", value: "invite-1" }],
      }),
      skip: 0,
      limit: 10,
    })
  })

  it("paginates through every attributed application", async () => {
    renderSection()
    await screen.findByText("Ada Lovelace")

    fireEvent.click(screen.getByRole("button", { name: "Next" }))

    await waitFor(() =>
      expect(mocks.listApplications).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 10, limit: 10 }),
      ),
    )
  })
})
