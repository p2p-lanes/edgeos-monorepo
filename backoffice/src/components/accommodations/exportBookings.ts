/**
 * Download the bookings CSV the property owner asks for.
 *
 * The CSV is rendered by the backend, not assembled here, because it is the
 * same file the partner share link serves and the two must not drift. This
 * only turns the response into a saved file.
 */

import { AccommodationsService, type BookingStatus } from "@/client"

export interface BookingFilters {
  popupId: string
  dateFrom: string
  dateTo: string
  propertyId?: string | null
  accommodationId?: string | null
  statuses?: BookingStatus[] | null
  search?: string | null
}

export async function downloadBookingsCsv(
  filters: BookingFilters,
): Promise<void> {
  // The endpoint answers `text/csv`, which the generated client types as
  // `unknown` and Axios hands back verbatim as a string.
  const csv = (await AccommodationsService.exportBookings({
    popupId: filters.popupId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    propertyId: filters.propertyId ?? undefined,
    accommodationId: filters.accommodationId ?? undefined,
    statuses: filters.statuses?.length ? filters.statuses : undefined,
    search: filters.search?.trim() || undefined,
  })) as string

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `bookings-${filters.dateFrom}-${filters.dateTo}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
