import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { AttendeeCategoryPublic } from "@/client"
import { AttendeeCategoriesEditor } from "./AttendeeCategoriesEditor"

// Mock the generated client service
vi.mock("@/client", () => ({
  AttendeeCategoriesService: {
    listAttendeeCategories: vi.fn(),
    createAttendeeCategory: vi.fn(),
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
const mockCreate =
  AttendeeCategoriesService.createAttendeeCategory as ReturnType<typeof vi.fn>
const mockDelete =
  AttendeeCategoriesService.deleteAttendeeCategory as ReturnType<typeof vi.fn>

function makeCategory(
  overrides: Partial<AttendeeCategoryPublic> = {},
): AttendeeCategoryPublic {
  return {
    id: "cat-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    key: "spouse",
    is_primary: false,
    sort_order: 1,
    enabled_in_passes_flow: true,
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
  it("renders a list of category rows from API", async () => {
    const categories = [
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
    mockList.mockResolvedValue({ results: categories })

    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => {
      expect(screen.getByText("Spouse")).toBeInTheDocument()
      expect(screen.getByText("Kid")).toBeInTheDocument()
    })
  })

  it("shows empty state when no categories", async () => {
    mockList.mockResolvedValue({ results: [] })

    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => {
      expect(screen.getByText(/no companion types/i)).toBeInTheDocument()
    })
  })

  it("create mutation fires when form is submitted with a new key", async () => {
    mockList.mockResolvedValue({ results: [] })
    mockCreate.mockResolvedValue(
      makeCategory({
        id: "cat-new",
        key: "teen",
        display_meta: { label: "Teen" },
      }),
    )

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
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
          requestBody: expect.objectContaining({
            popup_id: "popup-1",
            key: "teen",
          }),
        }),
      )
    })
  })

  it("delete button is disabled for is_primary categories", async () => {
    const primary = makeCategory({
      id: "cat-main",
      key: "main",
      is_primary: true,
      display_meta: { label: "Main" },
    })
    mockList.mockResolvedValue({ results: [primary] })

    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText("Main"))

    const deleteBtn = screen.getByRole("button", { name: /delete main/i })
    expect(deleteBtn).toBeDisabled()
  })

  it("delete mutation fires for non-primary category", async () => {
    const category = makeCategory({
      id: "cat-spouse",
      key: "spouse",
      display_meta: { label: "Spouse" },
    })
    mockList.mockResolvedValue({ results: [category] })
    mockDelete.mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
      wrapper: wrapper(),
    })

    await waitFor(() => screen.getByText("Spouse"))

    const deleteBtn = screen.getByRole("button", { name: /delete spouse/i })
    await user.click(deleteBtn)

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(
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
    mockList.mockResolvedValue({ results: [category] })

    const user = userEvent.setup()
    render(<AttendeeCategoriesEditor popupId="popup-1" />, {
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
