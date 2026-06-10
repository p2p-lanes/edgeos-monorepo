import { CalendarClock } from "lucide-react"
import { useState } from "react"

import type { VenueAvailability } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { VenueDaySchedule } from "./VenueDaySchedule"

/**
 * Self-contained "View venue schedule" button + modal. Owns its own open
 * state so hosts only need to drop it in. Picking a free slot calls
 * `onPickTime` but keeps the modal open so the proposed block updates live;
 * the user closes via the X.
 */
export function VenueDayScheduleDialog({
  availability,
  timezone,
  dayKey,
  proposedStartIso,
  proposedEndIso,
  onPickTime,
}: {
  availability: VenueAvailability | undefined
  timezone: string
  dayKey: string
  proposedStartIso?: string | null
  proposedEndIso?: string | null
  onPickTime?: (isoUtc: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="mr-1 h-4 w-4" />
        View venue schedule
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Venue schedule</DialogTitle>
          </DialogHeader>
          <VenueDaySchedule
            availability={availability}
            timezone={timezone}
            dayKey={dayKey}
            proposedStartIso={proposedStartIso}
            proposedEndIso={proposedEndIso}
            onPickTime={onPickTime}
          />
          <p className="text-xs text-muted-foreground">
            Click a free slot to set the start time.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
