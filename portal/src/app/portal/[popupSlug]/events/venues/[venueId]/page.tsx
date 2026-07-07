"use client"

import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Clock,
  MapPin,
  Pencil,
  Users,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useTranslation } from "react-i18next"

import {
  type EventVenuePublic,
  EventVenuesService,
  HumansService,
} from "@/client"
import { LucideIcon } from "@/components/LucideIcon"
import { Pill } from "@/components/ui/pill"
import { VenueHoursPreview } from "@/components/VenueHoursPreview"
import { imageOptimization } from "@/lib/image-optimization"
import { useCityProvider } from "@/providers/cityProvider"
import { CoverImage } from "../../lib/CoverImage"

export default function PortalVenueDetailPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string; venueId: string }>()
  const searchParams = useSearchParams()
  const { getCity } = useCityProvider()
  const city = getCity()

  // When linked from an event detail page, `from` carries that page's
  // full path+query so we can return there. Restrict to same-origin
  // portal paths to avoid being used as an open redirect.
  const fromParam = searchParams.get("from")
  const cameFromEvent = !!fromParam && fromParam.startsWith("/portal/")
  const backHref = cameFromEvent
    ? (fromParam as string)
    : `/portal/${city?.slug}/events/venues`
  const backLabel = cameFromEvent
    ? t("events.form.back_to_event")
    : t("events.venues.detail.all_venues_link")

  // There is no single-venue portal endpoint; we fetch the full list and
  // pick the match. The list is capped at 200 on the server.
  const { data, isLoading } = useQuery({
    queryKey: ["portal-event-venues", city?.id],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })

  const venue: EventVenuePublic | undefined = data?.results.find(
    (v) => v.id === params.venueId,
  )
  const isOwner =
    venue != null && currentHuman != null && venue.owner_id === currentHuman.id

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
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        <p className="text-center py-20 text-muted-foreground">
          {t("events.venues.detail.venue_not_found")}
        </p>
      </div>
    )
  }

  const mapsUrl = (() => {
    if (venue.geo_lat != null && venue.geo_lng != null) {
      return `https://www.google.com/maps/@${venue.geo_lat},${venue.geo_lng},17z`
    }
    const query = [venue.title, venue.formatted_address || venue.location]
      .filter(Boolean)
      .join(", ")
    return query
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
      : null
  })()

  const gallery = [...(venue.photos ?? [])].sort(
    (a, b) => a.position - b.position,
  )

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        {isOwner && (
          <Link
            href={`/portal/${city?.slug}/events/venues/${venue.id}/edit`}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("events.venues.detail.edit_button")}
          </Link>
        )}
      </div>

      {venue.booking_mode === "approval_required" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold">
              {t("events.venues.detail.approval_required_banner_title")}
            </p>
            <p className="text-amber-900/90 dark:text-amber-100/90">
              {t("events.venues.detail.approval_required_banner_message")}
            </p>
          </div>
        </div>
      )}

      {/* Cover */}
      {venue.image_url && (
        <div className="overflow-hidden rounded-xl border">
          <CoverImage
            src={venue.image_url}
            alt={venue.title}
            className="aspect-[21/9] w-full object-cover"
            sizes="(max-width: 896px) 100vw, 864px"
            fallback={<MapPin className="h-10 w-10 text-muted-foreground/40" />}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {venue.title || t("events.venues.detail.untitled_venue")}
          </h1>
          {venue.location && (
            <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {venue.location}
            </p>
          )}
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 self-start rounded-lg border bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted whitespace-nowrap"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-green-500/10">
              <MapPin className="h-4 w-4 text-green-600" />
            </span>
            <span>
              {t("events.venues.detail.open_in_google_maps", {
                defaultValue: "Open in Google Maps",
              })}
            </span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
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
              <Pill
                key={p.id}
                variant="chip"
                icon={<LucideIcon name={p.icon} className="h-4 w-4" />}
              >
                {p.name}
              </Pill>
            ))}
          </div>
        </section>
      )}

      {/* Weekly hours */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {t("events.venues.detail.open_hours_heading")}
        </h2>
        <VenueHoursPreview hours={venue.weekly_hours} />
      </section>

      {/* Gallery */}
      {gallery.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            {t("events.venues.detail.gallery_heading")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {gallery.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square overflow-hidden rounded-lg border"
              >
                <Image
                  src={photo.image_url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, 296px"
                  className="object-cover"
                  {...imageOptimization(photo.image_url)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {(venue.tags?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            {t("events.venues.detail.details_heading")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {venue.tags?.map((t) => (
              <Pill key={`tag-${t}`}>{t}</Pill>
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
