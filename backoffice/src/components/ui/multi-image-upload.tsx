import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { ImageUpload } from "./image-upload"

interface MultiImageUploadProps {
  value: string[]
  onChange: (urls: string[]) => void
  className?: string
  disabled?: boolean
  /** Max number of images (inclusive). Defaults to no limit. */
  max?: number
}

export function MultiImageUpload({
  value,
  onChange,
  className,
  disabled,
  max,
}: MultiImageUploadProps) {
  const atCapacity = max !== undefined && value.length >= max

  const append = (url: string | null) => {
    if (!url) return
    if (atCapacity) return
    onChange([...value, url])
  }

  const removeAt = (idx: number) => {
    const next = value.slice()
    next.splice(idx, 1)
    onChange(next)
  }

  return (
    <div className={cn("space-y-3", className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((url, idx) => (
            <div key={`${url}-${idx}`} className="relative h-24 w-24">
              <div className="h-full w-full overflow-hidden rounded-lg border">
                <img
                  src={url}
                  alt={`Image ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
              </div>
              {!disabled && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  aria-label={`Remove image ${idx + 1}`}
                  className="absolute -top-2 -right-2 h-6 w-6"
                  onClick={() => removeAt(idx)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {!atCapacity && (
        <ImageUpload value={null} onChange={append} disabled={disabled} />
      )}
    </div>
  )
}
