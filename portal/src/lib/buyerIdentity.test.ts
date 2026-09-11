/**
 * What the checkout is allowed to stop asking, and what it must still ask.
 *
 * Both halves matter equally. Covering too little leaves the duplication
 * this was written to remove; covering too much means a question silently
 * disappears from the screen while the backend still refuses to take the
 * payment without it, which is a checkout that cannot be completed and
 * cannot be diagnosed from the buyer's side.
 */

import { describe, expect, it } from "vitest"
import type { SelectedAccommodationItem } from "@/types/checkout"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  buildBuyerIdentity,
  NO_BUYER_IDENTITY,
  withBuyerIdentity,
} from "./buyerIdentity"

function buyerForm(
  extra: ApplicationFormSchema["base_fields"] = {},
): ApplicationFormSchema {
  return {
    base_fields: {
      email: { type: "email", label: "Email", required: true },
      first_name: { type: "text", label: "First name", required: true },
      last_name: { type: "text", label: "Last name", required: true },
      ...extra,
    },
    custom_fields: {},
    sections: [],
  }
}

const VALUES = {
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
}

describe("a direct sale", () => {
  it("covers what the buyer step will ask, before it has been asked", () => {
    // The accommodation step runs first (housing is order 1, buyer order 4),
    // so at the moment a room is picked there is nothing typed yet. Reading
    // the schema rather than the values is what stops the step asking for an
    // email purely because the buyer has not reached the field yet.
    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm(),
      buyerValues: {},
    })

    expect(identity.covers.has("email")).toBe(true)
    expect(identity.covers.has("full_name")).toBe(true)
    expect(identity.namesLeadGuest).toBe(true)
    expect(identity.answers).toEqual({})
    expect(identity.name).toBe("")
  })

  it("answers with the values once they exist", () => {
    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm(),
      buyerValues: VALUES,
    })

    expect(identity.name).toBe("Ada Lovelace")
    expect(identity.email).toBe("ada@example.com")
    expect(identity.answers).toEqual({
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      name: "Ada Lovelace",
      full_name: "Ada Lovelace",
    })
  })

  it("covers a phone only when the buyer is asked for one", () => {
    expect(
      buildBuyerIdentity({ buyerFormSchema: buyerForm() }).covers.has("phone"),
    ).toBe(false)

    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm({
        phone: { type: "phone", label: "Phone", required: false },
      }),
      buyerValues: { ...VALUES, phone: "+54 11 5555 5555" },
    })
    expect(identity.answers.phone).toBe("+54 11 5555 5555")
  })

  it("finds the phone under whatever the popup called it", () => {
    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm({
        whatsapp: { type: "phone", label: "WhatsApp", required: false },
      }),
      buyerValues: { ...VALUES, whatsapp: "+54 11 4444 4444" },
    })

    expect(identity.answers.phone).toBe("+54 11 4444 4444")
  })

  it("wins over a signed-in account, which may be somebody else", () => {
    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm(),
      buyerValues: VALUES,
      human: { email: "grace@example.com", first_name: "Grace" },
    })

    expect(identity.email).toBe("ada@example.com")
  })
})

describe("an application flow", () => {
  it("takes the buyer from the account, which has no buyer step", () => {
    const identity = buildBuyerIdentity({
      human: {
        email: "ada@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
      },
    })

    expect(identity.name).toBe("Ada Lovelace")
    expect(identity.covers.has("email")).toBe(true)
    expect(identity.namesLeadGuest).toBe(true)
  })

  it("keeps asking for what the account is missing", () => {
    // Unlike the buyer form there is no promise to come: a blank on the
    // account is a blank, so the step must go on asking for it.
    const identity = buildBuyerIdentity({
      human: { email: "ada@example.com", first_name: null, last_name: null },
    })

    expect(identity.covers.has("email")).toBe(true)
    expect(identity.covers.has("full_name")).toBe(false)
    expect(identity.namesLeadGuest).toBe(false)
  })

  it("knows nothing when nobody is signed in and nothing is asked", () => {
    expect(buildBuyerIdentity({}).covers.size).toBe(0)
  })
})

describe("what never gets covered", () => {
  it("leaves a question that is not about the buyer alone", () => {
    // Matching on the key and not the type is the whole guard here: an
    // emergency contact's email is an email field asking for somebody else's.
    const identity = buildBuyerIdentity({
      buyerFormSchema: buyerForm(),
      buyerValues: VALUES,
    })

    expect(identity.covers.has("emergency_email")).toBe(false)
    expect(identity.covers.has("passport")).toBe(false)
    expect(identity.covers.has("date_of_birth")).toBe(false)
  })
})

function stay(
  overrides: Partial<SelectedAccommodationItem> = {},
): SelectedAccommodationItem {
  return {
    accommodationId: "room-1",
    productId: "product-1",
    name: "Classic Double",
    propertyId: "prop-1",
    propertyName: "Hotel Arcadia",
    checkIn: "2026-09-14",
    checkOut: "2026-09-18",
    nights: 4,
    guestCount: 2,
    guests: [
      { name: "", answers: {} },
      { name: "", answers: {} },
    ],
    bookerAnswers: {},
    guestForm: null,
    subtotal: 400,
    tax: 40,
    totalPrice: 440,
    imageUrl: null,
    ...overrides,
  } as SelectedAccommodationItem
}

describe("folding the buyer back into a booking", () => {
  const identity = buildBuyerIdentity({
    buyerFormSchema: buyerForm(),
    buyerValues: VALUES,
  })

  it("fills the answers the step stopped asking for", () => {
    const filled = withBuyerIdentity(stay(), identity)

    expect(filled.bookerAnswers.email).toBe("ada@example.com")
    expect(filled.guests[0].name).toBe("Ada Lovelace")
    expect(filled.guests[0].answers.full_name).toBe("Ada Lovelace")
  })

  it("never overwrites what the buyer typed", () => {
    // Booking a room for somebody else is ordinary, and putting the payer's
    // name back on it would hand the property the wrong registry entry.
    const filled = withBuyerIdentity(
      stay({
        bookerAnswers: { email: "front-desk@example.com" },
        guests: [
          { name: "Grace Hopper", answers: {} },
          { name: "", answers: {} },
        ],
      }),
      identity,
    )

    expect(filled.bookerAnswers.email).toBe("front-desk@example.com")
    expect(filled.guests[0].name).toBe("Grace Hopper")
  })

  it("leaves the other occupants entirely alone", () => {
    const filled = withBuyerIdentity(stay(), identity)

    expect(filled.guests[1].name).toBe("")
    expect(filled.guests[1].answers).toEqual({})
  })

  it("changes nothing when the checkout knows nobody", () => {
    const item = stay()
    expect(withBuyerIdentity(item, NO_BUYER_IDENTITY)).toBe(item)
  })
})
