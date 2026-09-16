import type { AttendeeWithOriginPublic, PaymentPublic } from "@/client"

export interface AccessTicket {
  id: string
  name: string
  checkInCode: string
  lastScanAt: string | null
  duration: string | null
  requiresCheckIn: boolean
  grantsEventAccess: boolean
}

export interface AccessHolder {
  holderId: string
  holderName: string | null
  tickets: AccessTicket[]
}

export function projectTicketAccess(
  attendees: AttendeeWithOriginPublic[],
  payments: PaymentPublic[] = [],
): AccessHolder[] {
  const access: AccessHolder[] = []
  const holders = new Map<string, AccessHolder>()
  const attendeesById = new Map(
    attendees.map((attendee) => [attendee.id, attendee]),
  )
  const seenUnitIds = new Set<string>()

  const holderFor = (attendee: AttendeeWithOriginPublic) => {
    const existing = holders.get(attendee.id)
    if (existing) return existing

    const holder = {
      holderId: attendee.id,
      holderName: attendee.name,
      tickets: [],
    }
    holders.set(attendee.id, holder)
    access.push(holder)
    return holder
  }

  for (const attendee of attendees) {
    for (const product of attendee.products ?? []) {
      const grantsEventAccess =
        product.product_category_snapshot?.toLowerCase() === "ticket"
      const requiresCheckIn = product.requires_check_in === true

      if (
        product.revoked_at != null ||
        product.attendee_id !== attendee.id ||
        (!grantsEventAccess && !requiresCheckIn) ||
        seenUnitIds.has(product.id)
      ) {
        continue
      }

      seenUnitIds.add(product.id)
      holderFor(attendee).tickets.push({
        id: product.id,
        name: product.product_name ?? product.check_in_code,
        checkInCode: product.check_in_code,
        lastScanAt: product.last_scan_at ?? null,
        duration: product.duration_type ?? null,
        requiresCheckIn,
        grantsEventAccess,
      })
    }
  }

  let purchased: AccessHolder | null = null
  for (const payment of payments) {
    for (const product of payment.products_snapshot ?? []) {
      for (const unit of product.units ?? []) {
        if (
          !unit.active ||
          !unit.requires_check_in ||
          seenUnitIds.has(unit.id)
        ) {
          continue
        }

        seenUnitIds.add(unit.id)
        const ticket = {
          id: unit.id,
          name: product.product_name,
          checkInCode: unit.check_in_code,
          lastScanAt: null,
          duration: null,
          requiresCheckIn: true,
          grantsEventAccess:
            product.product_category.toLowerCase() === "ticket",
        }
        const attendee = unit.attendee_id
          ? attendeesById.get(unit.attendee_id)
          : undefined

        if (attendee) {
          holderFor(attendee).tickets.push(ticket)
          continue
        }

        if (!purchased) {
          purchased = {
            holderId: "purchased-by-you",
            holderName: null,
            tickets: [],
          }
          access.push(purchased)
        }
        purchased.tickets.push(ticket)
      }
    }
  }

  return access
}
