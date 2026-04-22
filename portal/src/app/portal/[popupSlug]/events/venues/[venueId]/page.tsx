"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpRight, Clock, MapPin, Users } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useTranslation } from "react-i18next"

import { type EventVenuePublic, EventVenuesService } from "@/client"
import { LucideIcon } from "@/components/LucideIcon"
import { VenueHoursSummary } from "@/components/VenueHoursSummary"
import { useCityProvider } from "@/providers/cityProvider"

export default function PortalVenueDetailPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string; venueId: string }>()
  const { getCity } = useCityProvider()
  const city = getCity()

  // There is no single-venue portal endpoint; we fetch the full list and
  // pick the match. The list is capped at 200 on the server.
  const { data, isLoading } = useQuery({
    queryKey: ["portal-event-venues", city?.id],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })

  const venue: EventVenuePublic | undefined = data?.results.find(
    (v) => v.id === params.venueId,
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!venue) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <Link
          href={`/portal/${city?.slug}/events/venues`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />{" "}
          {t("events.venues.detail.all_venues_link")}
        </Link>
        <p className="text-center py-20 text-muted-foreground">
          {t("events.venues.detail.venue_not_found")}
        </p>
      </div>
    )
  }

  const mapsUrl =
    venue.geo_lat != null && venue.geo_lng != null
      ? `https://www.google.com/maps/@${venue.geo_lat},${venue.geo_lng},17z`
      : null

  const gallery = [...(venue.photos ?? [])].sort(
    (a, b) => a.position - b.position,
  )

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <Link
        href={`/portal/${city?.slug}/events/venues`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />{" "}
        {t("events.venues.detail.all_venues_link")}
      </Link>

      {/* Cover */}
      {venue.image_url && (
        <div className="overflow-hidden rounded-xl border">
          {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
          <img
            src={venue.image_url}
            alt={venue.title}
            className="aspect-[21/9] w-full object-cover"
          />
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {venue.title || t("events.venues.detail.untitled_venue")}
        </h1>
        {venue.location && (
          <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {venue.location}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-0.5 underline"
              >
                {t("events.venues.detail.map_link")}{" "}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </p>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCard
          label={t("events.venues.detail.capacity_label")}
          value={venue.capacity != null ? String(venue.capacity) : "—"}
          icon={<Users className="h-4 w-4" />}
        />
        <InfoCard
          label={t("events.venues.detail.setup_label")}
          value={
            venue.setup_time_minutes != null
              ? t("events.venues.detail.setup_value", {
                  minutes: venue.setup_time_minutes,
                })
              : "—"
          }
          icon={<Clock className="h-4 w-4" />}
        />
        <InfoCard
          label={t("events.venues.detail.teardown_label")}
          value={
            venue.teardown_time_minutes != null
              ? t("events.venues.detail.teardown_value", {
                  minutes: venue.teardown_time_minutes,
                })
              : "—"
          }
          icon={<Clock className="h-4 w-4" />}
        />
        <InfoCard
          label={t("events.venues.detail.booking_label")}
          value={
            venue.booking_mode === "approval_required"
              ? t("events.venues.detail.booking_approval")
              : venue.booking_mode === "unbookable"
                ? t("events.venues.detail.booking_unbookable")
                : t("events.venues.detail.booking_free")
          }
        />
      </div>

      {/* Properties */}
      {venue.properties && venue.properties.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            {t("events.venues.detail.properties_heading")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {venue.properties.map((p) => (
              <div
                key={p.id}
                className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"
              >
                <LucideIcon name={p.icon} className="h-4 w-4" />
                <span>{p.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Weekly hours */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {t("events.venues.detail.open_hours_heading")}
        </h2>
        <VenueHoursSummary hours={venue.weekly_hours} />
      </section>

      {/* Gallery */}
      {gallery.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            {t("events.venues.detail.gallery_heading")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {gallery.map((photo) => (
              <div key={photo.id} className="overflow-hidden rounded-lg border">
                {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
                <img
                  src={photo.image_url}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tags + amenities */}
      {((venue.tags?.length ?? 0) > 0 ||
        (venue.amenities?.length ?? 0) > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            {t("events.venues.detail.details_heading")}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {venue.tags?.map((t) => (
              <span
                key={`tag-${t}`}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
              >
                {t}
              </span>
            ))}
            {venue.amenities?.map((a) => (
              <span
                key={`amen-${a}`}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {a}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function InfoCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-base font-medium">{value}</p>
    </div>
  )
}
