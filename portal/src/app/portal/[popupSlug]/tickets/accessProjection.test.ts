import { describe, expect, it } from "vitest"
import type { AttendeeWithOriginPublic } from "@/client"
import { projectScannableAccess } from "./accessProjection"

describe("projectScannableAccess", () => {
  it("groups only scannable tickets by their real holder", () => {
    const access = projectScannableAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "ticket-1",
            attendee_id: "holder-1",
            product_id: "general-admission",
            check_in_code: "CHECK-IN-1",
            product_name: "General Admission",
            product_category: "General",
            duration_type: "week",
            requires_check_in: true,
            last_scan_at: "2026-08-21T12:00:00Z",
          },
          {
            id: "merch-1",
            attendee_id: "holder-1",
            product_id: "shirt",
            check_in_code: "MERCH-1",
            product_name: "Event shirt",
            requires_check_in: false,
          },
          {
            id: "experience-1",
            attendee_id: "holder-1",
            product_id: "workshop",
            check_in_code: "EXPERIENCE-1",
            product_name: "Workshop",
            requires_check_in: false,
          },
        ],
      } as AttendeeWithOriginPublic,
      {
        id: "holder-2",
        name: "Jamie Morgan",
        products: [
          {
            id: "ticket-2",
            attendee_id: "holder-2",
            product_id: "volunteer-access",
            check_in_code: "CHECK-IN-2",
            product_name: "Volunteer Access",
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access).toEqual([
      {
        holderId: "holder-1",
        holderName: "Alex Morgan",
        tickets: [
          {
            id: "ticket-1",
            name: "General Admission",
            checkInCode: "CHECK-IN-1",
            lastScanAt: "2026-08-21T12:00:00Z",
            category: "General",
            duration: "week",
          },
        ],
      },
      {
        holderId: "holder-2",
        holderName: "Jamie Morgan",
        tickets: [
          {
            id: "ticket-2",
            name: "Volunteer Access",
            checkInCode: "CHECK-IN-2",
            lastScanAt: null,
            category: null,
            duration: null,
          },
        ],
      },
    ])
  })

  it("returns no access holders when all products are non-scannable", () => {
    const access = projectScannableAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "merch-1",
            attendee_id: "holder-1",
            product_id: "shirt",
            check_in_code: "MERCH-1",
            requires_check_in: false,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access).toEqual([])
  })
})
