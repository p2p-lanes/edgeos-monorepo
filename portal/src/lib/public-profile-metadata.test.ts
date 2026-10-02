import { describe, expect, it } from "vitest"
import { buildCheckoutRecipientDraft } from "@/types/checkout"
import { publicProfileMetadata } from "./public-profile-metadata"

const legacyMetadata = {
  rating: "red_flag",
  red_flag: true,
  enriched_profile: { bio: "Internal research" },
  dietary_notes: "vegetarian",
  answers: { rating: "Nested survey answer" },
}

const safeMetadata = {
  dietary_notes: "vegetarian",
  answers: { rating: "Nested survey answer" },
}

describe("public profile metadata", () => {
  it("drops reserved assessment keys without modifying the original", () => {
    expect(publicProfileMetadata(legacyMetadata)).toEqual(safeMetadata)
    expect(legacyMetadata.red_flag).toBe(true)
    expect(publicProfileMetadata(null)).toEqual({})
  })

  it("sanitizes legacy attendee data, restored drafts, and checkout overrides", () => {
    const recipient = buildCheckoutRecipientDraft(
      {
        id: "attendee-1",
        popup_id: "popup-1",
        tenant_id: "tenant-1",
        name: "Buyer",
        category: "main",
        human_id: "human-1",
        additional_data: legacyMetadata,
        products: [],
        recipient: {
          recipient_key: "human:human-1",
          name: "Buyer",
          profile_snapshot: legacyMetadata,
        },
      },
      { profileSnapshot: legacyMetadata },
    )
    expect(recipient.profile_snapshot).toEqual({
      ...safeMetadata,
      category: "main",
    })
  })
})
