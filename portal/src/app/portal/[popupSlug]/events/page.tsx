"use client"

import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { CalendarDays, Clock, Filter, MapPin, Search, Tag } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { EventsService, type EventPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCityProvider } from "@/providers/cityProvider"

function formatTime(dateStr: string) {
  return format(parseISO(dateStr), "HH:mm")
}

function formatDate(dateStr: string) {
  return format(parseISO(dateStr), "EEE, MMM d")
}

function groupByDate(events: EventPublic[]): [string, EventPublic[]][] {
  const groups: Record<string, EventPublic[]> = {}
  for (const event of events) {
    const key = format(parseISO(event.start_time), "yyyy-MM-dd")
    if (!groups[key]) groups[key] = []
    groups[key].push(event)
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
}

const statusColors: Record<string, string> = {
  published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function EventsPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const [search, setSearch] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["portal-events", city?.id, search],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        eventStatus: "published",
        limit: 200,
      }),
    enabled: !!city?.id,
  })

  const events = data?.results ?? []
  const grouped = groupByDate(events)

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex-none mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upcoming events at {city?.name}
        </p>
      </div>

      <div className="flex-none mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No events yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([date, dayEvents]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatDate(dayEvents[0].start_time)}
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2 pl-5 border-l-2 border-border">
                  {dayEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={`/portal/${city?.slug}/events/${event.id}`}
                      className="block rounded-xl border bg-card p-3 sm:p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-medium text-sm sm:text-base">
                          {event.title}
                        </h3>
                        <Badge
                          variant="secondary"
                          className={statusColors[event.status as string] ?? ""}
                        >
                          {event.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatTime(event.start_time)} – {formatTime(event.end_time)}
                        </span>
                      </div>
                      {event.location && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{event.location}</span>
                        </div>
                      )}
                      {event.tags && event.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {event.tags.slice(0, 3).map((tag: string) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-none mt-4 flex justify-center">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/portal/${city?.slug}/events/calendar`}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Calendar View
          </Link>
        </Button>
      </div>
    </div>
  )
}
