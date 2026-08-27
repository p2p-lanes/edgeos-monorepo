import type { AttendeeWithOriginPublic } from "@/client"

export interface ScannableAccessTicket {
  id: string
  name: string
  checkInCode: string
  lastScanAt: string | null
  duration: string | null
}

export interface ScannableAccessHolder {
  holderId: string
  holderName: string
  tickets: ScannableAccessTicket[]
}

export function projectScannableAccess(
  attendees: AttendeeWithOriginPublic[],
): ScannableAccessHolder[] {
  return attendees.flatMap((attendee) => {
    const tickets = (attendee.products ?? [])
      .filter(
        (product) =>
          product.requires_check_in && product.attendee_id === attendee.id,
      )
      .map((product) => ({
        id: product.id,
        name: product.product_name ?? product.check_in_code,
        checkInCode: product.check_in_code,
        lastScanAt: product.last_scan_at ?? null,
        duration: product.duration_type ?? null,
      }))

    return tickets.length > 0
      ? [{ holderId: attendee.id, holderName: attendee.name, tickets }]
      : []
  })
}
