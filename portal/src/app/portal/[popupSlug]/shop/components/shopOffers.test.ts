import { describe, expect, it } from "vitest"
import { getEligibleShopOffers } from "./shopOffers"

const attendeeFlow = { id: "attendee-1", slug: "attendee", name: "Attendee" }
const directFlow = { id: "direct-1", slug: "merch-store", name: "Merch Store" }

describe("getEligibleShopOffers", () => {
  it("keeps purchasable attendee inventory available to an approved applicant", () => {
    expect(
      getEligibleShopOffers({
        application: [attendeeFlow],
        direct: [],
        upsale: [],
        isApplicationApproved: true,
      }),
    ).toEqual([{ key: "application", flows: [attendeeFlow] }])
  })

  it("hides attendee inventory from an unapproved applicant", () => {
    expect(
      getEligibleShopOffers({
        application: [attendeeFlow],
        direct: [],
        upsale: [],
        isApplicationApproved: false,
      }),
    ).toEqual([])
  })

  it("hides attendee Shop when no purchasable attendee inventory exists", () => {
    expect(
      getEligibleShopOffers({
        application: [],
        direct: [],
        upsale: [],
        isApplicationApproved: true,
      }),
    ).toEqual([])
  })

  it("keeps Shop available when another eligible flow exists", () => {
    expect(
      getEligibleShopOffers({
        application: [attendeeFlow],
        direct: [directFlow],
        upsale: [],
        isApplicationApproved: false,
      }),
    ).toEqual([{ key: "direct", flows: [directFlow] }])
  })
})
