"use client"

import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { VariantProps } from "../registries/variantRegistry"

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  )
  return match?.[1] ?? null
}

export default function VariantYouTubeVideo({
  onSkip,
  templateConfig,
}: VariantProps) {
  const youtubeUrl = (templateConfig?.youtube_url as string) || ""
  const videoId = youtubeUrl ? extractVideoId(youtubeUrl) : null

  if (!videoId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Play className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No video available for this step.</p>
        <Button variant="outline" onClick={onSkip}>
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-sm border border-gray-100 bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-gray-500 hover:text-gray-700 underline text-sm transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
