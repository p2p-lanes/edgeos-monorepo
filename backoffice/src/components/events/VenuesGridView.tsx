import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { MapPin, Users } from "lucide-react"
import { type EventVenuePublic, EventVenuesService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { LucideIcon } from "@/components/LucideIcon"
import { Skeleton } from "@/components/ui/skeleton"
import { CoverImage } from "./CoverImage"

interface VenuesGridViewProps {
  popupId: string
  search: string
}

/**
 * Card grid of venues for the backoffice, mirroring the portal layout
 * (16/9 cover, capacity, property chips). Cards open the read-only venue
 * detail page; admin actions stay on the table view.
 */
export function VenuesGridView({ popupId, search }: VenuesGridViewProps) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ["event-venues", "grid", { popupId, search }],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId,
        search: search || undefined,
        skip: 0,
        limit: 500,
      }),
    enabled: !!popupId,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const venues: EventVenuePublic[] = data?.results ?? []

  if (venues.length === 0) {
    return search ? (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No venues match your search.
      </div>
    ) : (
      <EmptyState
        icon={MapPin}
        title="No venues yet"
        description="Venues will appear here when created."
      />
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {venues.map((venue) => (
        <button
          key={venue.id}
          type="button"
          onClick={() =>
            navigate({
              to: "/events/venues/$venueId/edit",
              params: { venueId: venue.id },
            })
          }
          className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-shadow hover:shadow-md"
        >
          <CoverImage
            src={venue.image_url}
            alt={venue.title}
            className="aspect-[16/9] w-full object-cover"
            fallback={<MapPin className="h-8 w-8 text-muted-foreground/40" />}
          />
          <div className="flex-1 p-4">
            <h3 className="mb-1 font-semibold text-base transition-colors group-hover:text-primary">
              {venue.title || "Untitled venue"}
            </h3>
            {venue.location && (
              <p className="line-clamp-1 text-sm text-muted-foreground">
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
        </button>
      ))}
    </div>
  )
}
