import { describe, expect, it } from "vitest"
import type { AttendeeWithOriginPublic, PaymentPublic } from "@/client"
import { projectTicketAccess } from "./accessProjection"

describe("projectTicketAccess", () => {
  it("shows the QR when check-in is enabled after purchase", () => {
    const access = projectTicketAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "ticket-1",
            attendee_id: "holder-1",
            product_id: "week-pass",
            check_in_code: "CHECK-IN-1",
            product_name: "Week 2",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: false,
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access[0]?.tickets).toMatchObject([
      {
        id: "ticket-1",
        requiresCheckIn: true,
        checkInCode: "CHECK-IN-1",
      },
    ])
  })

  it("shows active buyer-owned parking without assigning it to an attendee", () => {
    const access = projectTicketAccess(
      [],
      [
        {
          id: "parking-payment",
          buyer_human_id: "buyer-1",
          products_snapshot: [
            {
              product_name: "Parking",
              product_category: "parking",
              requires_check_in_snapshot: true,
              units: [
                {
                  id: "parking-unit",
                  attendee_id: null,
                  check_in_code: "PARK1234",
                  active: true,
                  requires_check_in: true,
                },
              ],
            },
          ],
        } as PaymentPublic,
      ],
    )

    expect(access).toEqual([
      {
        holderId: "purchased-by-you",
        holderName: null,
        tickets: [
          {
            id: "parking-unit",
            name: "Parking",
            checkInCode: "PARK1234",
            lastScanAt: null,
            duration: null,
            requiresCheckIn: true,
            grantsEventAccess: false,
          },
        ],
      },
    ])
  })

  it("groups active event access and check-in items by their real holder", () => {
    const access = projectTicketAccess([
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
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            duration_type: "week",
            requires_check_in: true,
            last_scan_at: "2026-08-21T12:00:00Z",
          },
          {
            id: "ticket-no-check-in",
            attendee_id: "holder-1",
            product_id: "speaker-access",
            check_in_code: "NOT-SCANNABLE",
            product_name: "Speaker Access",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: false,
          },
          {
            id: "ticket-revoked",
            attendee_id: "holder-1",
            product_id: "revoked-access",
            check_in_code: "REVOKED",
            product_name: "Revoked Access",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: false,
            revoked_at: "2026-08-22T12:00:00Z",
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
          {
            id: "parking-1",
            attendee_id: "holder-1",
            product_id: "parking",
            check_in_code: "PARK1234",
            product_name: "Parking",
            product_category_snapshot: "parking",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
          {
            id: "unresolved-1",
            attendee_id: "holder-1",
            product_id: "live-ticket",
            check_in_code: "UNRESOLVED",
            product_name: "Shuttle",
            product_category: "ticket",
            product_category_snapshot: null,
            requires_check_in_snapshot: true,
            requires_check_in: true,
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
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
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
            duration: "week",
            requiresCheckIn: true,
            grantsEventAccess: true,
          },
          {
            id: "ticket-no-check-in",
            name: "Speaker Access",
            checkInCode: "NOT-SCANNABLE",
            lastScanAt: null,
            duration: null,
            requiresCheckIn: false,
            grantsEventAccess: true,
          },
          {
            id: "parking-1",
            name: "Parking",
            checkInCode: "PARK1234",
            lastScanAt: null,
            duration: null,
            requiresCheckIn: true,
            grantsEventAccess: false,
          },
          {
            id: "unresolved-1",
            name: "Shuttle",
            checkInCode: "UNRESOLVED",
            lastScanAt: null,
            duration: null,
            requiresCheckIn: true,
            grantsEventAccess: false,
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
            duration: null,
            requiresCheckIn: true,
            grantsEventAccess: true,
          },
        ],
      },
    ])
  })

  it("returns no access holders when all products lack ticket access", () => {
    const access = projectTicketAccess([
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

  it("merges purchased units, deduplicates attendee units, and excludes inactive or non-scannable ownerless units", () => {
    const access = projectTicketAccess(
      [
        {
          id: "holder-1",
          name: "Alex Morgan",
          products: [
            {
              id: "shared-parking",
              attendee_id: "holder-1",
              product_id: "parking",
              product_name: "Parking",
              check_in_code: "SHARED",
              product_category_snapshot: "parking",
              requires_check_in_snapshot: true,
            },
            {
              id: "revoked-parking",
              attendee_id: "holder-1",
              product_id: "parking",
              product_name: "Revoked Parking",
              check_in_code: "REVOKED",
              product_category_snapshot: "parking",
              requires_check_in_snapshot: true,
              revoked_at: "2026-08-22T12:00:00Z",
            },
          ],
        } as AttendeeWithOriginPublic,
      ],
      [
        {
          id: "parking-payment",
          products_snapshot: [
            {
              product_name: "Parking",
              product_category: "parking",
              requires_check_in_snapshot: true,
              units: [
                {
                  id: "shared-parking",
                  attendee_id: "holder-1",
                  check_in_code: "SHARED",
                  active: true,
                  requires_check_in: true,
                },
                {
                  id: "assigned-parking",
                  attendee_id: "holder-1",
                  check_in_code: "ASSIGNED",
                  active: true,
                  requires_check_in: true,
                },
                {
                  id: "inactive-parking",
                  attendee_id: null,
                  check_in_code: "INACTIVE",
                  active: false,
                  requires_check_in: true,
                },
                {
                  id: "ownerless-merch",
                  attendee_id: null,
                  check_in_code: "MERCH",
                  active: true,
                  requires_check_in: false,
                },
                {
                  id: "ownerless-parking",
                  attendee_id: null,
                  check_in_code: "OWNERLESS",
                  active: true,
                  requires_check_in: true,
                },
              ],
            },
          ],
        } as PaymentPublic,
      ],
    )

    expect(access).toMatchObject([
      {
        holderId: "holder-1",
        holderName: "Alex Morgan",
        tickets: [
          { id: "shared-parking", grantsEventAccess: false },
          { id: "assigned-parking", grantsEventAccess: false },
        ],
      },
      {
        holderId: "purchased-by-you",
        holderName: null,
        tickets: [{ id: "ownerless-parking", grantsEventAccess: false }],
      },
    ])
    expect(
      access.flatMap((holder) => holder.tickets).map((ticket) => ticket.id),
    ).toEqual(["shared-parking", "assigned-parking", "ownerless-parking"])
  })

  it("excludes a scannable product nested under a different holder", () => {
    const access = projectTicketAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "ticket-alex",
            attendee_id: "holder-1",
            product_id: "general-admission",
            check_in_code: "ALEX-CODE",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
          {
            id: "ticket-jamie",
            attendee_id: "holder-2",
            product_id: "general-admission",
            check_in_code: "JAMIE-CODE",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access).toMatchObject([
      {
        holderId: "holder-1",
        tickets: [{ id: "ticket-alex", checkInCode: "ALEX-CODE" }],
      },
    ])
  })

  it("retains the same product for each of its distinct holders", () => {
    const access = projectTicketAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "ticket-alex",
            attendee_id: "holder-1",
            product_id: "general-admission",
            check_in_code: "ALEX-CODE",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
      {
        id: "holder-2",
        name: "Jamie Morgan",
        products: [
          {
            id: "ticket-jamie",
            attendee_id: "holder-2",
            product_id: "general-admission",
            check_in_code: "JAMIE-CODE",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access).toMatchObject([
      {
        holderId: "holder-1",
        tickets: [{ id: "ticket-alex", checkInCode: "ALEX-CODE" }],
      },
      {
        holderId: "holder-2",
        tickets: [{ id: "ticket-jamie", checkInCode: "JAMIE-CODE" }],
      },
    ])
  })

  it("retains distinct ticket rows for the same product and holder", () => {
    const access = projectTicketAccess([
      {
        id: "holder-1",
        name: "Alex Morgan",
        products: [
          {
            id: "ticket-1",
            attendee_id: "holder-1",
            product_id: "general-admission",
            check_in_code: "ALEX-CODE-1",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
          {
            id: "ticket-2",
            attendee_id: "holder-1",
            product_id: "general-admission",
            check_in_code: "ALEX-CODE-2",
            product_category: "ticket",
            product_category_snapshot: "ticket",
            requires_check_in_snapshot: true,
            requires_check_in: true,
          },
        ],
      } as AttendeeWithOriginPublic,
    ])

    expect(access[0]?.tickets).toMatchObject([
      { id: "ticket-1", checkInCode: "ALEX-CODE-1" },
      { id: "ticket-2", checkInCode: "ALEX-CODE-2" },
    ])
  })
})
