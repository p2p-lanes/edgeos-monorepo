import type { EventVenuePublic } from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { VenueHoursPreview } from "@/components/VenueHoursPreview"

interface Props {
  venue: EventVenuePublic | null | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VenueDetailsDialog({ venue, open, onOpenChange }: Props) {
  if (!venue) return null

  const hasMeta =
    venue.capacity != null ||
    !!venue.booking_mode ||
    venue.setup_time_minutes != null ||
    venue.teardown_time_minutes != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{venue.title || "Venue details"}</DialogTitle>
          <DialogDescription>
            Weekly schedule and booking details for this venue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {hasMeta && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {venue.capacity != null && (
                <span>
                  <strong className="text-foreground">Capacity:</strong>{" "}
                  {venue.capacity}
                </span>
              )}
              {venue.booking_mode && (
                <span>
                  <strong className="text-foreground">Booking:</strong>{" "}
                  {venue.booking_mode}
                </span>
              )}
              {venue.setup_time_minutes != null && (
                <span>
                  <strong className="text-foreground">Setup:</strong>{" "}
                  {venue.setup_time_minutes} min
                </span>
              )}
              {venue.teardown_time_minutes != null && (
                <span>
                  <strong className="text-foreground">Teardown:</strong>{" "}
                  {venue.teardown_time_minutes} min
                </span>
              )}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Weekly hours
            </p>
            <VenueHoursPreview hours={venue.weekly_hours ?? []} />
          </div>

          {venue.description && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                About
              </p>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                {venue.description}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
