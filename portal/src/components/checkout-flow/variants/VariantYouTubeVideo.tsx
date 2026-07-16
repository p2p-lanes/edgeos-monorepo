"use client"

import { Play } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { VariantProps } from "../registries/variantRegistry"

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  )
  return match?.[1] ?? null
}

// Facade pattern: mounting the real YouTube iframe pulls the full player
// (hundreds of KB of third-party JS) the moment the section renders. Until
// the user actually presses play we only show the video thumbnail, then
// swap in the iframe with autoplay so the click still starts playback.
export default function VariantYouTubeVideo({
  onSkip,
  templateConfig,
}: VariantProps) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const youtubeUrl = (templateConfig?.youtube_url as string) || ""
  const videoId = youtubeUrl ? extractVideoId(youtubeUrl) : null

  if (!videoId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Play className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-6">{t("checkout.no_video")}</p>
        <Button variant="outline" onClick={onSkip}>
          {t("common.continue")}
        </Button>
      </div>
    )
  }

  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  return (
    <div className="space-y-6">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-sm border border-border bg-black">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
            title="YouTube video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={t("checkout.video.play_youtube_aria")}
            className="group absolute inset-0 h-full w-full cursor-pointer"
          >
            <Image
              src={thumbnailUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 672px"
              className="object-cover"
              // YouTube's own CDN — never in our optimizer allowlist, and the
              // thumbnail is already small; serve it as-is.
              unoptimized
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 transition-transform group-hover:scale-110">
                <Play className="ml-1 h-8 w-8 fill-white text-white" />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
