import { describe, expect, it } from "vitest"
import en from "./locales/en.json"
import es from "./locales/es.json"
import is from "./locales/is.json"
import zh from "./locales/zh.json"

describe("Recipient assignment localization", () => {
  const locales = { en, es, is, zh }

  it.each(
    Object.entries(locales),
  )("defines the complete assignment journey for %s", (_locale, messages) => {
    const assignment = messages.checkout.recipient_assignment
    expect(Object.keys(assignment)).toEqual(
      Object.keys(en.checkout.recipient_assignment),
    )
    expect(Object.keys(assignment.roles)).toEqual(
      Object.keys(en.checkout.recipient_assignment.roles),
    )
    expect(Object.keys(assignment.fields)).toEqual(
      Object.keys(en.checkout.recipient_assignment.fields),
    )
    expect(Object.values(assignment).every(Boolean)).toBe(true)
    expect(Object.values(assignment.roles).every(Boolean)).toBe(true)
    expect(Object.values(assignment.fields).every(Boolean)).toBe(true)
  })

  it("uses non-English Spanish action and form labels", () => {
    expect(es.checkout.recipient_assignment).toMatchObject({
      add_role: "Agregar {{role}}",
      full_name: "Nombre completo",
      save: "Guardar",
    })
  })
})
