"use client"

import { AlertTriangle, Images } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { EventVenuePublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { VenueHoursSummary } from "@/components/VenueHoursSummary"
import { VenueSelect } from "./VenueSelect"

interface EventVenueFieldProps {
  venueId: string
  onVenueChange: (next: string) => void
  venues: EventVenuePublic[]
  selectedVenue: EventVenuePublic | undefined
  selectedDateIsClosed: boolean
  /**
   * Label to show for `venueId` when it isn't in `venues` (edit page on
   * first paint, or soft-deleted venues). Without this, Radix Select has
   * no SelectItem to read the trigger label from and shows the placeholder.
   */
  selectedVenueLabel?: string
}

export function EventVenueField({
  venueId,
  onVenueChange,
  venues,
  selectedVenue,
  selectedDateIsClosed,
  selectedVenueLabel,
}: EventVenueFieldProps) {
  const { t } = useTranslation()
  const [picturesOpen, setPicturesOpen] = useState(false)

  // Combine the venue's cover and gallery into a single ordered list. The
  // cover comes first (when present), followed by gallery photos sorted by
  // their stored position.
  const pictures = useMemo(() => {
    if (!selectedVenue) return [] as { id: string; url: string }[]
    const gallery = [...(selectedVenue.photos ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ id: p.id, url: p.image_url }))
    const cover = selectedVenue.image_url
      ? [{ id: "__cover__", url: selectedVenue.image_url }]
      : []
    return [...cover, ...gallery]
  }, [selectedVenue])

  return (
    <div className="space-y-2">
      <Label>{t("events.form.venue_label")}</Label>
      <VenueSelect
        venueId={venueId}
        onVenueChange={onVenueChange}
        venues={venues}
        selectedVenueLabel={selectedVenueLabel}
      />
      {selectedVenue?.booking_mode === "approval_required" && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>{t("events.form.venue_approval_required")}</p>
        </div>
      )}
      {selectedVenue && (
        <div className="text-xs text-muted-foreground space-y-2">
          {pictures.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPicturesOpen(true)}
            >
              <Images className="mr-1 h-4 w-4" />
              {t("events.form.view_pictures_button")}
            </Button>
          )}
          {selectedVenue.weekly_hours && (
            <VenueHoursSummary hours={selectedVenue.weekly_hours} />
          )}
          {selectedVenue.booking_mode === "unbookable" && (
            <p className="text-destructive">
              {t("events.form.venue_not_bookable")}
            </p>
          )}
          {(selectedVenue.setup_time_minutes ?? 0) > 0 ||
          (selectedVenue.teardown_time_minutes ?? 0) > 0 ? (
            <p>
              {t("events.form.venue_setup_teardown", {
                setupTime: selectedVenue.setup_time_minutes ?? 0,
                teardownTime: selectedVenue.teardown_time_minutes ?? 0,
              })}
            </p>
          ) : null}
          {selectedDateIsClosed && (
            <p className="text-destructive">
              {t("events.form.venue_closed_warning")}
            </p>
          )}
        </div>
      )}

      <Dialog open={picturesOpen} onOpenChange={setPicturesOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("events.form.venue_pictures_heading", {
                venue:
                  selectedVenue?.title ||
                  t("events.venues.list.untitled_venue"),
              })}
            </DialogTitle>
          </DialogHeader>
          {pictures.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {pictures.map((photo) => (
                <div
                  key={photo.id}
                  className="overflow-hidden rounded-lg border"
                >
                  {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
                  <img
                    src={photo.url}
                    alt=""
                    className="aspect-[4/3] w-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("events.form.no_venue_pictures")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
