"use client"

import { ArrowLeft, Calendar, Check, Layers, Link2, Search } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCityProvider } from "@/providers/cityProvider"
import { usePopupTracks } from "../lib/usePopupTracks"

export default function PortalTracksPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()

  const { tracksWithEvents, isLoading } = usePopupTracks(city?.id)

  const [search, setSearch] = useState("")

  // Track-filtered calendar link. Sharing this URL re-opens the calendar
  // with the track pre-selected (the events page seeds its filter from
  // `?tracks=`).
  const calendarHref = (trackId: string) =>
    `/portal/${city?.slug}/events?view=calendar&tracks=${trackId}`

  const filtered = useMemo(() => {
    const sorted = [...tracksWithEvents].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (track) =>
        track.name.toLowerCase().includes(q) ||
        (track.description ?? "").toLowerCase().includes(q) ||
        (track.topic ?? []).some((topic) => topic.toLowerCase().includes(q)),
    )
  }, [tracksWithEvents, search])

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const handleCopyLink = async (trackId: string) => {
    if (typeof window === "undefined") return
    const url = `${window.location.origin}${calendarHref(trackId)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(trackId)
      setTimeout(() => setCopiedId((id) => (id === trackId ? null : id)), 2000)
      toast.success(t("events.tracks.list.link_copied"))
    } catch {
      toast.error(t("events.tracks.list.link_error"))
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" /> {t("events.common.back_to_events")}
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <Layers className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          {t("events.tracks.list.heading")}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {t("events.tracks.list.subheading", { cityName: city?.name ?? "" })}
      </p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("events.tracks.list.search_placeholder")}
          className="pl-9"
          aria-label={t("events.tracks.list.search_placeholder")}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">
            {search
              ? t("events.tracks.list.no_matches")
              : t("events.tracks.list.empty_state")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((track) => (
            <li key={track.id}>
              <div className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
                <Link
                  href={calendarHref(track.id)}
                  className="flex min-w-0 flex-1 flex-col"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-base group-hover:text-primary transition-colors">
                      {track.name}
                    </h3>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      {t("events.tracks.list.event_count", {
                        count: track.eventCount,
                      })}
                    </span>
                  </div>
                  {track.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {track.description}
                    </p>
                  )}
                  {track.topic && track.topic.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {track.topic.map((topic) => (
                        <Badge key={topic} variant="secondary">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleCopyLink(track.id)}
                  aria-label={t("events.tracks.list.share_link")}
                  title={t("events.tracks.list.share_link")}
                >
                  {copiedId === track.id ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
