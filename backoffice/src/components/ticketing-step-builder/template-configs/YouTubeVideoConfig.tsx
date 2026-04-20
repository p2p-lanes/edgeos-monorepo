import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { TemplateConfigProps } from "./types"

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  )
  return match?.[1] ?? null
}

export function YouTubeVideoConfig({ config, onChange }: TemplateConfigProps) {
  const youtubeUrl = (config?.youtube_url as string) || ""
  const videoId = youtubeUrl ? extractVideoId(youtubeUrl) : null

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className="text-sm font-medium">YouTube URL</Label>
        <p className="text-xs text-muted-foreground">
          Paste a YouTube URL (e.g. https://www.youtube.com/watch?v=...)
        </p>
      </div>
      <Input
        type="url"
        placeholder="https://www.youtube.com/watch?v=..."
        value={youtubeUrl}
        onChange={(e) => onChange({ ...config, youtube_url: e.target.value })}
      />
      {videoId && (
        <div className="rounded-lg overflow-hidden border border-border">
          <img
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt="Video thumbnail"
            className="w-full h-auto"
          />
        </div>
      )}
    </div>
  )
}
