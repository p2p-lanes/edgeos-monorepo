import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { HumanSelfPublic } from "@/client"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import HumanForm from "./HumanForm"

vi.mock("@/hooks/useApplicationSchema", () => ({
  useApplicationSchema: vi.fn(),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const profile = {
  first_name: "Taylor",
  last_name: "Doe",
  email: "taylor@example.test",
} as HumanSelfPublic

function renderForm(initial: { age: string; gender: string }) {
  const saved = vi.fn()

  function Form() {
    const [editForm, setEditForm] = useState({
      ...profile,
      ...initial,
      telegram: "",
      residence: "",
    })
    return (
      <HumanForm
        userData={profile}
        isEditing
        setIsEditing={vi.fn()}
        handleSave={() => saved(editForm)}
        handleCancel={vi.fn()}
        editForm={editForm}
        setEditForm={setEditForm}
      />
    )
  }

  render(<Form />)
  return saved
}

describe("HumanForm", () => {
  it("uses the selected popup's age options without losing an older value", async () => {
    vi.mocked(useApplicationSchema).mockReturnValue({
      data: {
        base_fields: {
          age: {
            type: "select",
            label: "Age",
            required: false,
            options: ["21-29", "30-39"],
          },
          gender: {
            type: "select",
            label: "Gender",
            required: false,
            options: ["Female", "Male", "Specify"],
          },
        },
        custom_fields: {},
        sections: [],
      },
    } as ReturnType<typeof useApplicationSchema>)
    const saved = renderForm({ age: "30", gender: "Female" })

    expect(useApplicationSchema).toHaveBeenCalledWith("popup-1")
    expect(
      screen.getByRole("combobox", { name: "profile.age" }).textContent,
    ).toContain("30")
    fireEvent.click(screen.getByRole("combobox", { name: "profile.age" }))
    fireEvent.click(screen.getByRole("option", { name: "30-39" }))
    fireEvent.click(screen.getByRole("button", { name: "common.save" }))

    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ age: "30-39", gender: "Female" }),
    )
    expect(screen.queryByRole("textbox", { name: "profile.age" })).toBeNull()
  })

  it("keeps an existing age outside the current choices when saved unchanged", () => {
    vi.mocked(useApplicationSchema).mockReturnValue({
      data: {
        base_fields: {
          age: {
            type: "select",
            label: "Age",
            required: false,
            options: ["21-29", "30-39"],
          },
        },
        custom_fields: {},
        sections: [],
      },
    } as ReturnType<typeof useApplicationSchema>)
    const saved = renderForm({ age: "30", gender: "Female" })

    fireEvent.click(screen.getByRole("button", { name: "common.save" }))
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ age: "30" }))
  })

  it("preserves a specified gender until changed to a configured option", async () => {
    vi.mocked(useApplicationSchema).mockReturnValue({
      data: {
        base_fields: {
          gender: {
            type: "select",
            label: "Gender",
            required: false,
            options: ["Female", "Male", "Specify"],
          },
        },
        custom_fields: {},
        sections: [],
      },
    } as ReturnType<typeof useApplicationSchema>)
    const saved = renderForm({ age: "25-34", gender: "Fluid" })

    expect(
      (
        screen.getByRole("textbox", {
          name: "form.gender_specify",
        }) as HTMLInputElement
      ).value,
    ).toBe("Fluid")
    fireEvent.click(screen.getByRole("combobox", { name: "form.gender" }))
    fireEvent.click(screen.getByRole("option", { name: "form.gender_male" }))
    expect(
      screen.queryByRole("textbox", { name: "form.gender_specify" }),
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "common.save" }))
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ gender: "Male" }),
    )
  })

  it("requires a value after selecting Specify", () => {
    vi.mocked(useApplicationSchema).mockReturnValue({
      data: {
        base_fields: {
          gender: {
            type: "select",
            label: "Gender",
            required: false,
            options: ["Female", "Specify"],
          },
        },
        custom_fields: {},
        sections: [],
      },
    } as ReturnType<typeof useApplicationSchema>)
    const saved = renderForm({ age: "25-34", gender: "Female" })

    fireEvent.click(screen.getByRole("combobox", { name: "form.gender" }))
    fireEvent.click(
      screen.getByRole("option", { name: "form.gender_specify_own" }),
    )
    const save = screen.getByRole("button", {
      name: "common.save",
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const specify = screen.getByRole("textbox", { name: "form.gender_specify" })
    fireEvent.change(specify, { target: { value: "Fluid" } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ gender: "Fluid" }),
    )
  })
})
