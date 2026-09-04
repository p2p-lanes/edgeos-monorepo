/**
 * The property editor.
 *
 * What is worth pinning here is the body it sends, not the markup: an empty
 * lodging tax has to travel as `null` and not as `""` or `0`, because NULL
 * means "no tax line at all" while 0 prints a zero tax line in every quote.
 * The rest of the fields are checked for the same reason: this form replaced
 * a dialog that silently dropped `description` and `sort_order`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  AccommodationsService: {
    createProperty: vi.fn(),
    updateProperty: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { AccommodationsService } from "@/client"
import { PropertyForm } from "./PropertyForm"

const mockCreate = vi.mocked(AccommodationsService.createProperty)
const mockUpdate = vi.mocked(AccommodationsService.updateProperty)

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderForm(props: Partial<Parameters<typeof PropertyForm>[0]> = {}): {
  onSuccess: () => void
} {
  const onSuccess = vi.fn()
  render(
    <Wrapper>
      <PropertyForm popupId="popup-1" onSuccess={onSuccess} {...props} />
    </Wrapper>,
  )
  return { onSuccess }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ id: "prop-1" } as never)
  mockUpdate.mockResolvedValue({ id: "prop-1" } as never)
})

describe("PropertyForm", () => {
  it("cannot be saved without a name", async () => {
    renderForm()

    const button = screen.getByRole("button", { name: "Create property" })
    expect(button.hasAttribute("disabled")).toBe(true)

    await userEvent.type(screen.getByLabelText("Name"), "Hotel Arcadia")

    expect(button.hasAttribute("disabled")).toBe(false)
  })

  it("sends an empty lodging tax as null, not as zero", async () => {
    renderForm()

    await userEvent.type(screen.getByLabelText("Name"), "Hotel Arcadia")
    await userEvent.click(
      screen.getByRole("button", { name: "Create property" }),
    )

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0].requestBody.tax_percentage).toBeNull()
  })

  it("creates a property with every field the page collects", async () => {
    const { onSuccess } = renderForm()

    await userEvent.type(screen.getByLabelText("Name"), "Hotel Arcadia")
    await userEvent.type(screen.getByLabelText("Address"), "12 Lake Road")
    await userEvent.type(
      screen.getByLabelText("Description"),
      "Two blocks from the lake.",
    )
    await userEvent.type(screen.getByLabelText("Contact name"), "Marta")
    await userEvent.type(
      screen.getByLabelText("Contact email"),
      "marta@example.com",
    )
    await userEvent.type(screen.getByLabelText("Tax (%)"), "21")
    await userEvent.clear(screen.getByLabelText("Sort order"))
    await userEvent.type(screen.getByLabelText("Sort order"), "3")

    await userEvent.click(
      screen.getByRole("button", { name: "Create property" }),
    )

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0].requestBody).toEqual({
      popup_id: "popup-1",
      name: "Hotel Arcadia",
      address: "12 Lake Road",
      description: "Two blocks from the lake.",
      contact_name: "Marta",
      contact_email: "marta@example.com",
      tax_percentage: "21",
      is_active: true,
      sort_order: 3,
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it("updates instead of creating when it was given a property", async () => {
    renderForm({
      defaultValues: {
        id: "prop-1",
        popup_id: "popup-1",
        tenant_id: "tenant-1",
        name: "Hotel Arcadia",
        address: null,
        description: null,
        contact_name: null,
        contact_email: null,
        tax_percentage: "21",
        is_active: true,
        sort_order: 0,
      },
    })

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate.mock.calls[0][0].propertyId).toBe("prop-1")
    // Untouched values survive the round trip: the form is the only writer of
    // this row, so anything it drops here is lost.
    expect(mockUpdate.mock.calls[0][0].requestBody.tax_percentage).toBe("21")
  })
})
