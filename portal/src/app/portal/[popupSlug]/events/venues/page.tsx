"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, MapPin, Plus, Users } from "lucide-react"
import Link from "next/link"

import { type EventVenuePublic, EventVenuesService } from "@/client"
import { LucideIcon } from "@/components/LucideIcon"
import { Button } from "@/components/ui/button"
import { useCityProvider } from "@/providers/cityProvider"
import { usePortalEventSettings } from "../lib/useEventTimezone"

export default function PortalVenuesPage() {
  const { getCity } = useCityProvider()
  const city = getCity()

  const { data, isLoading } = useQuery({
    queryKey: ["portal-event-venues", city?.id],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })
  const { data: settings } = usePortalEventSettings(city?.id)
  const canCreateVenue = settings?.humans_can_create_venues === true

  const venues: EventVenuePublic[] = data?.results ?? []

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Venues</h1>
        </div>
        {canCreateVenue && (
          <Button asChild size="sm">
            <Link
              href={`/portal/${city?.slug}/events/venues/new`}
              className="inline-flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> New venue
            </Link>
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Spaces available for events at {city?.name}.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : venues.length === 0 ? (
        <div className="text-center py-20">
          <MapPin className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No venues yet</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {venues.map((venue) => (
            <Link
              key={venue.id}
              href={`/portal/${city?.slug}/events/venues/${venue.id}`}
              className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
            >
              {venue.image_url ? (
                // biome-ignore lint/performance/noImgElement: portal uses plain imgs for cover photos uploaded to S3
                <img
                  src={venue.image_url}
                  alt={venue.title}
                  className="aspect-[16/9] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[16/9] w-full items-center justify-center bg-muted">
                  <MapPin className="h-8 w-8 text-muted-foreground/40" />
                </div>
              )}
              <div className="flex-1 p-4">
                <h3 className="font-semibold text-base mb-1 group-hover:text-primary transition-colors">
                  {venue.title || "Untitled venue"}
                </h3>
                {venue.location && (
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {venue.location}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  {venue.capacity != null && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {venue.capacity}
                    </span>
                  )}
                </div>
                {venue.properties && venue.properties.length > 0 && (
                  <ul
                    aria-label="Venue properties"
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {venue.properties.slice(0, 6).map((p) => (
                      <li
                        key={p.id}
                        title={p.name}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <LucideIcon name={p.icon} className="h-3 w-3" />
                        <span className="max-w-[8rem] truncate">{p.name}</span>
                      </li>
                    ))}
                    {venue.properties.length > 6 && (
                      <li className="inline-flex items-center rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        +{venue.properties.length - 6}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
