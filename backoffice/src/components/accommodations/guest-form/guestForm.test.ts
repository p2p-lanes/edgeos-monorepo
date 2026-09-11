/**
 * The rules the guest-form editor builds by.
 *
 * These mirror `GuestFormField` / `AccommodationGuestForm` in the backend's
 * `guest_form.py`. The point of the client copy is that a form the editor
 * lets you build is a form the API accepts: anything this allows and the
 * server refuses reaches the operator as a 422 with no field to point at.
 */

import { describe, expect, it } from "vitest"
import {
  CHOICE_TYPES,
  emptyForm,
  fieldProblem,
  formProblem,
  GUEST_FIELD_TYPES,
  guestFieldsOf,
  isEmpty,
  makeField,
  makeKey,
  PRESETS,
  parseForm,
  takenKeys,
  toApi,
  toSchemaField,
} from "./guestForm"

describe("field types", () => {
  it("offers only the types the backend accepts", () => {
    // The backend's GUEST_FORM_FIELD_TYPES, verbatim. Signature and image
    // upload need an upload target this path does not have; the card pickers
    // are merchandising controls rather than questions.
    expect(GUEST_FIELD_TYPES.map((type) => type.value).sort()).toEqual([
      "boolean",
      "country_select",
      "date",
      "email",
      "multiselect",
      "number",
      "phone",
      "radio",
      "rich_text",
      "select",
      "text",
      "textarea",
      "url",
    ])
  })
})

describe("makeKey", () => {
  it("slugifies the label", () => {
    expect(makeKey("Passport number", "text", [])).toBe("passport_number")
  })

  it("does not collide with a key already in use", () => {
    expect(makeKey("Age", "number", ["age"])).toBe("age_2")
    expect(makeKey("Age", "number", ["age", "age_2"])).toBe("age_3")
  })

  it("falls back to the type when the label slugifies to nothing", () => {
    // A field with no key cannot store an answer at all, so an unslugifiable
    // label must not produce one.
    expect(makeKey("???", "email", [])).toBe("email")
    expect(makeKey("", "", [])).toBe("field")
  })
})

describe("makeField", () => {
  it("gives a choice field somewhere to start", () => {
    // A select with no options cannot be saved, so offering one empty is
    // offering a validation error.
    const field = makeField("select", "Diet", [])

    expect(field.options.length).toBeGreaterThan(0)
    expect(fieldProblem(field)).toBeNull()
  })

  it("leaves a plain field without options", () => {
    expect(makeField("text", "Full name", []).options).toEqual([])
  })

  it("is not required by default", () => {
    expect(makeField("text", "Full name", []).required).toBe(false)
  })
})

describe("the key survives a rename", () => {
  it("keeps the answers where they already are", () => {
    // This is the whole reason the key exists separately from the label:
    // renaming a question must not orphan the answers stored under it.
    const field = makeField("number", "Age", [])
    const renamed = { ...field, label: "Age at check-in" }

    expect(renamed.key).toBe("age")
  })
})

describe("guestFieldsOf", () => {
  const form = emptyForm()
  form.booker.fields = [makeField("email", "Email", [])]
  form.guests.fields = [makeField("number", "Age", ["email"])]

  it("repeats the booker fields under same_as_booker", () => {
    expect(
      guestFieldsOf({
        ...form,
        guests: { ...form.guests, mode: "same_as_booker" },
      }),
    ).toEqual(form.booker.fields)
  })

  it("uses the guests own list under custom", () => {
    expect(
      guestFieldsOf({ ...form, guests: { ...form.guests, mode: "custom" } }),
    ).toEqual(form.guests.fields)
  })

  it("asks nothing under off", () => {
    expect(
      guestFieldsOf({ ...form, guests: { ...form.guests, mode: "off" } }),
    ).toEqual([])
  })
})

describe("isEmpty and toApi", () => {
  it("treats a form with no questions as no form", () => {
    expect(isEmpty(emptyForm())).toBe(true)
    expect(toApi(emptyForm())).toBeNull()
  })

  it("is not empty when only the guests are asked something", () => {
    const form = emptyForm()
    form.guests.mode = "custom"
    form.guests.fields = [makeField("text", "Full name", [])]

    expect(isEmpty(form)).toBe(false)
    expect(toApi(form)).not.toBeNull()
  })

  it("is empty when the only questions are for guests who are asked nothing", () => {
    const form = emptyForm()
    form.guests.mode = "off"
    form.guests.fields = [makeField("text", "Full name", [])]

    expect(isEmpty(form)).toBe(true)
  })
})

describe("takenKeys", () => {
  it("spans both sections, so a new key is unique across the form", () => {
    const form = emptyForm()
    form.booker.fields = [makeField("email", "Email", [])]
    form.guests.fields = [makeField("number", "Age", ["email"])]

    expect(takenKeys(form)).toEqual(["email", "age"])
  })
})

describe("formProblem", () => {
  it("names the question that cannot be saved", () => {
    const form = emptyForm()
    form.booker.fields = [{ ...makeField("select", "Diet", []), options: [] }]

    expect(formProblem(form)).toContain("Diet")
    expect(formProblem(form)).toContain("option")
  })

  it("catches a question with no label", () => {
    const form = emptyForm()
    form.booker.fields = [
      { ...makeField("text", "Full name", []), label: "  " },
    ]

    expect(formProblem(form)).toContain("label")
  })

  it("passes a well-formed form", () => {
    const form = emptyForm()
    form.booker.fields = [makeField("email", "Email", [])]

    expect(formProblem(form)).toBeNull()
  })
})

describe("parseForm", () => {
  it("reads a stored form back", () => {
    const form = PRESETS[0].build()

    expect(parseForm(JSON.parse(JSON.stringify(form)))).toEqual(form)
  })

  it("returns an empty form rather than throwing on nonsense", () => {
    // The editor opens on whatever is stored. A shape that no longer makes
    // sense should leave it empty, not blank the page.
    expect(isEmpty(parseForm(null))).toBe(true)
    expect(isEmpty(parseForm("not a form"))).toBe(true)
    expect(isEmpty(parseForm({ booker: { fields: [{ no: "key" }] } }))).toBe(
      true,
    )
  })

  it("drops a field with no key but keeps its neighbours", () => {
    const parsed = parseForm({
      booker: { fields: [{ no: "key" }, { key: "age", label: "Age" }] },
    })

    expect(parsed.booker.fields.map((field) => field.key)).toEqual(["age"])
  })

  it("falls back to same_as_booker on an unknown mode", () => {
    expect(parseForm({ guests: { mode: "sideways" } }).guests.mode).toBe(
      "same_as_booker",
    )
  })
})

describe("presets", () => {
  it("every preset builds a form the API would accept", () => {
    for (const preset of PRESETS) {
      expect(formProblem(preset.build())).toBeNull()
    }
  })

  it("start from scratch is the only empty one", () => {
    const empty = PRESETS.filter((preset) => isEmpty(preset.build()))

    expect(empty.map((preset) => preset.key)).toEqual(["blank"])
  })

  it("never asks for a name or an email, which the checkout already has", () => {
    // Both are collected from the buyer once, by the buyer step or from the
    // signed-in account, and filed with the booking. A preset that asked
    // again would be rebuilding the duplication these were rewritten to
    // remove, and the checkout would hide the question anyway.
    const keys = PRESETS.flatMap((preset) => [
      ...preset.build().booker.fields,
      ...preset.build().guests.fields,
    ]).map((field) => field.key)

    expect(keys).not.toContain("email")
    expect(keys).not.toContain("full_name")
    expect(keys).not.toContain("name")
  })
})

describe("toSchemaField", () => {
  it("hands the preview what the checkout renders", () => {
    const field = { ...makeField("select", "Diet", []), required: true }

    expect(toSchemaField(field)).toMatchObject({
      type: "select",
      label: "Diet",
      required: true,
      options: field.options,
    })
  })

  it("omits options where there are none, rather than sending an empty list", () => {
    expect(
      toSchemaField(makeField("text", "Full name", [])).options,
    ).toBeUndefined()
  })
})

describe("CHOICE_TYPES", () => {
  it("covers every type whose answer comes from a list", () => {
    expect([...CHOICE_TYPES].sort()).toEqual(["multiselect", "radio", "select"])
  })
})
