import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the generated client module BEFORE importing the component
vi.mock("@/client", () => ({
  TicketTierGroupsService: {
    listTierGroups: vi.fn(),
    createTierGroup: vi.fn(),
  },
}))

import { TicketTierGroupsService } from "@/client"
import { TierGroupPicker } from "./TierGroupPicker"

const mockListTierGroups = vi.mocked(TicketTierGroupsService.listTierGroups)
const mockCreateTierGroup = vi.mocked(TicketTierGroupsService.createTierGroup)

const GROUP_A = {
  id: "group-a",
  tenant_id: "tenant-1",
  name: "Early Bird",
  shared_stock_cap: 100,
  shared_stock_remaining: 80,
  phases: [],
}

const GROUP_B = {
  id: "group-b",
  tenant_id: "tenant-1",
  name: "Regular",
  shared_stock_cap: 200,
  shared_stock_remaining: 0,
  phases: [],
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("TierGroupPicker", () => {
  const defaultProps = {
    popupId: "popup-1",
    value: null as string | null,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: listTierGroups resolves with two groups
    mockListTierGroups.mockResolvedValue({
      results: [GROUP_A, GROUP_B],
      paging: { limit: 200, offset: 0, total: 2 },
    } as Awaited<ReturnType<typeof TicketTierGroupsService.listTierGroups>>)
  })

  describe("renders list of existing tier groups", () => {
    it("shows all tier groups fetched from the API", async () => {
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText("Early Bird")).toBeInTheDocument()
        expect(screen.getByText("Regular")).toBeInTheDocument()
      })
    })

    it("calls listTierGroups with popup_id", async () => {
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        expect(mockListTierGroups).toHaveBeenCalledWith(
          expect.objectContaining({ popupId: "popup-1" }),
        )
      })
    })

    it("shows loading state while query is in flight", () => {
      // Never resolve so loading persists
      mockListTierGroups.mockReturnValue(
        new Promise(() => {}) as ReturnType<
          typeof TicketTierGroupsService.listTierGroups
        >,
      )

      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      expect(screen.getByRole("status")).toBeInTheDocument()
    })

    it("highlights the currently selected group via aria-pressed", async () => {
      render(<TierGroupPicker {...defaultProps} value="group-a" />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        const btn = screen.getByRole("button", { name: /early bird/i })
        expect(btn).toHaveAttribute("aria-pressed", "true")
      })
    })
  })

  describe("inline create flow", () => {
    it("shows 'Create new…' button", async () => {
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /create new/i }),
        ).toBeInTheDocument()
      })
    })

    it("opens inline form when 'Create new…' is clicked", async () => {
      const user = userEvent.setup()
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => screen.getByRole("button", { name: /create new/i }))

      await user.click(screen.getByRole("button", { name: /create new/i }))

      expect(screen.getByPlaceholderText(/group name/i)).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^create$/i }),
      ).toBeInTheDocument()
    })

    it("calls createTierGroup and auto-selects the new group on submit", async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const newGroup = { ...GROUP_A, id: "group-new", name: "Late Bird" }

      mockCreateTierGroup.mockResolvedValue(
        newGroup as Awaited<
          ReturnType<typeof TicketTierGroupsService.createTierGroup>
        >,
      )

      render(<TierGroupPicker {...defaultProps} onChange={onChange} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => screen.getByRole("button", { name: /create new/i }))

      await user.click(screen.getByRole("button", { name: /create new/i }))
      await user.type(screen.getByPlaceholderText(/group name/i), "Late Bird")
      await user.click(screen.getByRole("button", { name: /^create$/i }))

      await waitFor(() => {
        expect(mockCreateTierGroup).toHaveBeenCalled()
        expect(onChange).toHaveBeenCalledWith("group-new")
      })
    })

    it("cancels inline form without calling createTierGroup", async () => {
      const user = userEvent.setup()
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => screen.getByRole("button", { name: /create new/i }))

      await user.click(screen.getByRole("button", { name: /create new/i }))
      await user.click(screen.getByRole("button", { name: /cancel/i }))

      expect(mockCreateTierGroup).not.toHaveBeenCalled()
      expect(
        screen.queryByPlaceholderText(/group name/i),
      ).not.toBeInTheDocument()
    })
  })

  describe("group selection", () => {
    it("calls onChange with group id when a group is clicked", async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TierGroupPicker {...defaultProps} onChange={onChange} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => screen.getByRole("button", { name: /early bird/i }))
      await user.click(screen.getByRole("button", { name: /early bird/i }))

      expect(onChange).toHaveBeenCalledWith("group-a")
    })

    it("calls onChange with null when the selected group is clicked again (deselect)", async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <TierGroupPicker
          {...defaultProps}
          value="group-a"
          onChange={onChange}
        />,
        { wrapper: makeWrapper() },
      )

      await waitFor(() => screen.getByRole("button", { name: /early bird/i }))
      await user.click(screen.getByRole("button", { name: /early bird/i }))

      expect(onChange).toHaveBeenCalledWith(null)
    })

    it("marks groups with no remaining stock with a sold-out badge", async () => {
      render(<TierGroupPicker {...defaultProps} />, {
        wrapper: makeWrapper(),
      })

      await waitFor(() => {
        const soldOutBadge = screen.getByText(/sold.?out/i)
        expect(soldOutBadge).toBeInTheDocument()
      })
    })
  })
})
