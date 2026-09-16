import { Card } from "@/components/ui/card"
import { formatStayDate, nightsLabel } from "./bookingDetail"

interface StayBandProps {
  checkIn: string
  checkOut: string
  nights: number
  propertyName: string
  propertyAddress?: string | null
  accommodationName: string
  unitLabel?: string | null
}

/**
 * The stay, drawn as a stay.
 *
 * A booking is a span of nights in one specific bed, and every other view of
 * it in this product renders that as two date strings side by side. Here the
 * two ends of the span sit at the two ends of a rule with the night count on
 * it, so the duration is read rather than worked out, and the bed hangs
 * underneath as the three facts it actually is: a building, a kind of room,
 * and the door the guest walks through.
 *
 * The rule collapses on narrow screens, where a horizontal span has nowhere
 * to go and the dates read better stacked.
 */
export function StayBand({
  checkIn,
  checkOut,
  nights,
  propertyName,
  propertyAddress,
  accommodationName,
  unitLabel,
}: StayBandProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Check-in</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight">
            {formatStayDate(checkIn)}
          </span>
        </div>

        <div
          aria-hidden
          className="flex flex-1 items-center gap-3 text-muted-foreground"
        >
          <span className="hidden h-px flex-1 bg-border sm:block" />
          <span className="whitespace-nowrap text-xs tabular-nums">
            {nightsLabel(nights)}
          </span>
          <span className="hidden h-px flex-1 bg-border sm:block" />
        </div>

        <div className="flex flex-col gap-1 sm:items-end">
          <span className="text-xs text-muted-foreground">Check-out</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight">
            {formatStayDate(checkOut)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 border-t bg-muted/30 px-6 py-4 sm:grid-cols-3">
        <Fact label="Property" value={propertyName} detail={propertyAddress} />
        <Fact label="Room type" value={accommodationName} />
        <Fact label="Unit" value={unitLabel || "Not assigned"} />
      </div>
    </Card>
  )
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string | null
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
      {detail && (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
    </div>
  )
}
