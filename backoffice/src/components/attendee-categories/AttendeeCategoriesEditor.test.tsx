import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AttendeeCategoryPublic } from "@/client"
import { AttendeeCategoriesEditor } from "./AttendeeCategoriesEditor"

// Mock the generated client service
vi.mock("@/client", () => ({
  AttendeeCategoriesService: {
    listAttendeeCategories: vi.fn(),
    listSalesFlowAttendeeCategories: vi.fn(),
    createSalesFlowAttendeeCategory: vi.fn(),
    updateAttendeeCategory: vi.fn(),
    deleteAttendeeCategory: vi.fn(),
  },
}))

// Mock toast
vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { AttendeeCategoriesService } from "@/client"

const mockList = AttendeeCategoriesService.listAttendeeCategories as ReturnType<
  typeof vi.fn
>
const mockFlowList =
  AttendeeCategoriesService.listSalesFlowAttendeeCategories as ReturnType<
    typeof vi.fn
  >
const mockCreate =
  AttendeeCategoriesService.createSalesFlowAttendeeCategory as ReturnType<
    typeof vi.fn
  >
const mockUpdate =
  AttendeeCategoriesService.updateAttendeeCategory as ReturnType<typeof vi.fn>
const mockDelete =
  AttendeeCategoriesService.deleteAttendeeCategory as ReturnType<typeof vi.fn>
function makeCategory(
  overrides: Partial<AttendeeCategoryPublic> = {},
): AttendeeCategoryPublic {
  return {
    id: "cat-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    sales_flow_id: "flow-1",
    key: "spouse",
    is_primary: false,
    sort_order: 1,
    display_meta: { label: "Spouse" },
    required_fields: [],
    ...overrides,
  }
}

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return Wrapper
}

describe("AttendeeCategoriesEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowList.mockResolvedValue({ results: [] })
  })

  it("renders only category rows returned for the current flow", async () => {
    const flowCategories = [
      makeCategory({
        id: "cat-1",
        key: "spouse",
        display_meta: { label: "Spouse" },
      }),
      makeCategory({
        id: "cat-2",
        key: "kid",
        display_meta: { label: "Kid" },
        sort_order: 2,
      }),
    ]
    mockList.mockResolvedValue({
      results: [
        makeCategory({
          id: "popup-only",
          key: "popup-only",
          display_meta: { label: "Popup only" },
        }),
      ],
    })
    mockFlowList.mockResolvedValue({ results: flowCategories })

    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => {
      expect(screen.getByText("Spouse")).toBeInTheDocument()
      expect(screen.getByText("Kid")).toBeInTheDocument()
    })
    expect(screen.queryByText("Popup only")).not.toBeInTheDocument()
    expect(mockList).not.toHaveBeenCalled()
    expect(mockFlowList).toHaveBeenCalledWith({ flowId: "flow-1" })
  })

  it("shows empty state when no categories", async () => {
    mockFlowList.mockResolvedValue({ results: [] })

    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => {
      expect(screen.getByText(/no companion types/i)).toBeInTheDocument()
    })
  })

  it("create mutation fires when form is submitted with a new key", async () => {
    mockFlowList.mockResolvedValue({ results: [] })
    mockCreate.mockResolvedValue(
      makeCategory({
        id: "cat-new",
        key: "teen",
        display_meta: { label: "Teen" },
      }),
    )

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText(/no companion types/i))

    const addButton = screen.getByRole("button", { name: /add category/i })
    await user.click(addButton)

    const keyInput = screen.getByPlaceholderText(/e\.g\. spouse/i)
    await user.type(keyInput, "teen")

    const saveButton = screen.getByRole("button", { name: /create/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: "flow-1",
          requestBody: expect.objectContaining({
            popup_id: "popup-1",
            key: "teen",
          }),
        }),
      )
    })
  })

  it("keeps the main category delete disabled", async () => {
    const primary = makeCategory({
      id: "cat-main",
      key: "main",
      is_primary: true,
      display_meta: { label: "Main" },
    })
    mockFlowList.mockResolvedValue({ results: [primary] })

    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText("Main"))

    const deleteBtn = screen.getByRole("button", {
      name: /delete main/i,
    })
    expect(deleteBtn).toBeDisabled()
  })

  it("does not render availability switches or not allowed badges", async () => {
    const main = makeCategory({
      id: "cat-main",
      key: "main",
      is_primary: true,
      display_meta: { label: "Main" },
    })
    const spouse = makeCategory({ id: "cat-spouse" })
    mockFlowList.mockResolvedValue({ results: [main, spouse] })

    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await screen.findByText("Spouse")

    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(screen.queryByText("Not allowed")).not.toBeInTheDocument()
  })

  it("deletes a category and refetches the current flow rows", async () => {
    const main = makeCategory({
      id: "cat-main",
      key: "main",
      is_primary: true,
      display_meta: { label: "Main" },
    })
    const spouse = makeCategory({
      id: "cat-spouse",
      key: "spouse",
      display_meta: { label: "Spouse" },
    })
    mockFlowList
      .mockResolvedValueOnce({ results: [main, spouse] })
      .mockResolvedValue({ results: [main] })
    mockDelete.mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText("Spouse"))

    const deleteBtn = screen.getByRole("button", {
      name: /delete spouse/i,
    })
    await user.click(deleteBtn)

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ categoryId: "cat-spouse" })
      expect(mockFlowList).toHaveBeenCalledTimes(2)
      expect(screen.queryByText("Spouse")).not.toBeInTheDocument()
    })
  })

  it("updates an edited category by category ID", async () => {
    const category = makeCategory({ id: "cat-spouse" })
    mockFlowList.mockResolvedValue({ results: [category] })
    mockUpdate.mockResolvedValue(category)

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await user.click(
      await screen.findByRole("button", { name: /edit spouse/i }),
    )
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: "cat-spouse" }),
      )
    })
  })

  it("sort_order numeric input renders in edit dialog with category value", async () => {
    const category = makeCategory({
      id: "cat-1",
      key: "spouse",
      sort_order: 3,
      display_meta: { label: "Spouse" },
    })
    mockFlowList.mockResolvedValue({ results: [category] })

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" flowId="flow-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText("Spouse"))

    // Open edit dialog
    const editBtn = screen.getByRole("button", { name: /edit spouse/i })
    await user.click(editBtn)

    // Dialog should now be open with sort_order input pre-filled
    await waitFor(() => {
      const orderInput = screen.getByDisplayValue("3")
      expect(orderInput).toBeInTheDocument()
      expect(orderInput).toHaveAttribute("type", "number")
    })
  })
})
