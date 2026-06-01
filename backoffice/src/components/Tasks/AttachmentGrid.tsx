import { X } from "lucide-react"

import { Button } from "@/components/ui/button"

export interface AttachmentLike {
  url: string
  media_type: string
  filename?: string | null
}

interface AttachmentGridProps {
  items: AttachmentLike[]
  onRemove?: (index: number) => void
}

/** Renders task attachments — images inline, MP4s as playable <video> tags. */
export function AttachmentGrid({ items, onRemove }: AttachmentGridProps) {
  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={item.url}
          className="group relative overflow-hidden rounded-lg border bg-muted/30"
        >
          {item.media_type === "video" ? (
            // biome-ignore lint/a11y/useMediaCaption: user-uploaded bug recordings have no captions
            <video
              src={item.url}
              controls
              className="h-32 w-full object-contain"
            />
          ) : (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <img
                src={item.url}
                alt={item.filename ?? "attachment"}
                className="h-32 w-full object-contain"
              />
            </a>
          )}
          {onRemove && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              aria-label="Remove attachment"
              className="absolute right-1 top-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onRemove(index)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
