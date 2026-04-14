"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Layers } from "lucide-react"
import Link from "next/link"

import { TracksService, type TrackPublic } from "@/client"
import { useCityProvider } from "@/providers/cityProvider"

export default function TracksPage() {
  const { getCity } = useCityProvider()
  const city = getCity()

  const { data, isLoading } = useQuery({
    queryKey: ["portal-tracks", city?.id],
    queryFn: () =>
      TracksService.listPortalTracks({
        popupId: city!.id,
        limit: 200,
      }),
    enabled: !!city?.id,
  })

  const tracks: TrackPublic[] = data?.results ?? []

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Tracks</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Themed collections of events at {city?.name}.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-20">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No tracks yet</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {tracks.map((track) => (
            <Link
              key={track.id}
              href={`/portal/${city?.slug}/events/tracks/${track.id}`}
              className="block rounded-xl border bg-card p-4 hover:shadow-md transition-shadow"
            >
              <h3 className="font-semibold text-base mb-1">{track.name}</h3>
              {track.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {track.description}
                </p>
              )}
              {track.topic && track.topic.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {track.topic.slice(0, 4).map((t: string) => (
                    <span
                      key={t}
                      className="inline-flex items-center text-[10px] bg-muted px-1.5 py-0.5 rounded"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
