import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { AccommodationsService } from "@/client"
import { BookingDetailPage } from "@/components/accommodations/booking-detail/BookingDetailPage"
import { formatStayDate } from "@/components/accommodations/booking-detail/bookingDetail"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/accommodations/bookings/$id")({
  component: BookingRoute,
  head: () => ({
    meta: [{ title: "Booking - EdgeOS" }],
  }),
})

/** Back lands on the Bookings tab, not on the section's default calendar. */
function useBookingsGoBack() {
  const navigate = useNavigate()
  return useGoBack(() =>
    navigate({ to: "/accommodations", search: { tab: "bookings" } }),
  )
}

function BookingContent({ bookingId }: { bookingId: string }) {
  const goBack = useBookingsGoBack()
  const { data: booking } = useSuspenseQuery({
    queryKey: ["accommodations", "booking", bookingId],
    queryFn: () => AccommodationsService.getBooking({ bookingId }),
  })

  const isBlock = booking.kind === "block" || booking.kind === "maintenance"
  const title = isBlock
    ? "Blocked dates"
    : booking.primary_guest_name?.trim() || "Guest"

  return (
    <FormPageLayout
      title={title}
      description={`${booking.accommodation_name} at ${booking.property_name}, ${formatStayDate(booking.check_in)} to ${formatStayDate(booking.check_out)}`}
      backTo="/accommodations"
      onBack={goBack}
    >
      <BookingDetailPage booking={booking} onReleased={goBack} />
    </FormPageLayout>
  )
}

function BookingRoute() {
  const { id } = Route.useParams()

  return (
    <QueryErrorBoundary>
      {/* The title comes out of the booking, so the whole header waits for
          it rather than flashing a placeholder name. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <BookingContent bookingId={id} />
      </Suspense>
    </QueryErrorBoundary>
  )
}
