import { useQuery } from "@tanstack/react-query"
import { Check, ImageIcon } from "lucide-react"

import { AccommodationsService } from "@/client"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Picks photos for one room out of the popup-wide library.
 *
 * Selection is ordered: clicking adds to the end, and position 0 becomes the
 * cover the checkout card shows. The number badge makes that order visible.
 * Without it "which one is the cover" is invisible until you look at the
 * portal.
 */

interface PhotoLibraryPickerProps {
  popupId: string
  value: string[]
  onChange: (imageIds: string[]) => void
}

export function PhotoLibraryPicker({
  popupId,
  value,
  onChange,
}: PhotoLibraryPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["accommodations", "images", popupId],
    queryFn: () => AccommodationsService.listImages({ popupId }),
    enabled: !!popupId,
  })

  if (isLoading) return <Skeleton className="h-32 w-full" />

  const images = data?.results ?? []

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">The photo library is empty</p>
        <p className="text-xs text-muted-foreground">
          Upload photos in the Photos tab; they can then be reused across every
          room without uploading them twice.
        </p>
      </div>
    )
  }

  const toggle = (imageId: string) => {
    const position = value.indexOf(imageId)
    onChange(
      position === -1
        ? [...value, imageId]
        : value.filter((id) => id !== imageId),
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {images.map((image) => {
          const position = value.indexOf(image.id)
          const selected = position !== -1
          return (
            <button
              key={image.id}
              type="button"
              onClick={() => toggle(image.id)}
              aria-pressed={selected}
              aria-label={image.filename ?? "Photo"}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border-2 transition-all",
                selected
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-transparent hover:border-border",
              )}
            >
              <img
                src={image.url}
                alt={image.filename ?? ""}
                className="h-full w-full object-cover"
              />
              {selected && (
                <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {position === 0 ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    position + 1
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? "No photos selected."
          : "The first photo is the cover shown in the checkout."}
      </p>
    </div>
  )
}
