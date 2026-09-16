import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n/config"
import type { AttendeeCategoryForm, AttendeePassState } from "@/types/Attendee"
import { AttendeeModal } from "./AttendeeModal"

describe("AttendeeModal", () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage("en")
  })

  it("prefills and validates the selected role's required fields", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const category = {
      id: "category-spouse",
      key: "spouse",
      required_fields: [
        { name: "email", type: "email", required: true },
        { name: "residence", type: "text", required: true },
      ],
    } as AttendeeCategoryForm
    const attendee = {
      id: "existing-companion",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      name: "Existing Companion",
      email: "existing@example.com",
      gender: null,
      additional_data: { residence: "Lisbon" },
      products: [],
    } as AttendeePassState

    render(
      <AttendeeModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        category={category}
        editingAttendee={attendee}
      />,
    )

    const email = screen.getByLabelText(/Email/) as HTMLInputElement
    expect(email.value).toBe("existing@example.com")
    const residence = screen.getByLabelText(/Residence/) as HTMLInputElement
    expect(residence.value).toBe("Lisbon")

    fireEvent.change(residence, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Update" }))
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(residence, { target: { value: "Porto" } })
    fireEvent.click(screen.getByRole("button", { name: "Update" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "existing-companion",
        email: "existing@example.com",
        category_id: "category-spouse",
        additional_data: {
          email: "existing@example.com",
          residence: "Porto",
        },
      }),
    )
  })

  it("renders the assignment journey in Spanish", async () => {
    await i18n.changeLanguage("es")
    const category = {
      id: "category-spouse",
      key: "spouse",
      required_fields: [{ name: "email", type: "email", required: true }],
    } as AttendeeCategoryForm

    render(
      <AttendeeModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        category={category}
        editingAttendee={null}
      />,
    )

    expect(screen.getByText("Agregar Cónyuge")).toBeTruthy()
    expect(screen.getByLabelText(/Correo electrónico/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy()
  })
})
