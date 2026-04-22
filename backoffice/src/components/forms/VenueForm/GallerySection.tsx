import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, X } from "lucide-react"
import { useRef } from "react"

import { EventVenuesService } from "@/client"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import useCustomToast from "@/hooks/useCustomToast"
import { useFileUpload } from "@/hooks/useFileUpload"
import { createErrorHandler } from "@/utils"

const MAX_PHOTOS = 10

interface GallerySectionProps {
  venueId: string
}

export function GallerySection({ venueId }: GallerySectionProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const { uploadFile, isUploading } = useFileUpload()

  const { data: photos = [] } = useQuery({
    queryKey: ["event-venues", venueId, "photos"],
    queryFn: () => EventVenuesService.listPhotos({ venueId }),
  })

  const addPhotoMutation = useMutation({
    mutationFn: (image_url: string) =>
      EventVenuesService.addPhoto({
        venueId,
        requestBody: { image_url, position: photos.length },
      }),
    onSuccess: () => {
      showSuccessToast("Photo added")
      queryClient.invalidateQueries({
        queryKey: ["event-venues", venueId, "photos"],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) =>
      EventVenuesService.deletePhoto({ venueId, photoId }),
    onSuccess: () => {
      showSuccessToast("Photo removed")
      queryClient.invalidateQueries({
        queryKey: ["event-venues", venueId, "photos"],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleFile = async (file: File) => {
    try {
      const { publicUrl } = await uploadFile(file)
      addPhotoMutation.mutate(publicUrl)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Upload failed")
    }
  }

  const isAtMax = photos.length >= MAX_PHOTOS

  return (
    <InlineSection title="Gallery">
      <div className="space-y-3 py-3">
        <p className="text-xs text-muted-foreground">
          {photos.length}/{MAX_PHOTOS} photos. Changes save immediately.
        </p>
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative h-24 w-24 overflow-hidden rounded-md border"
            >
              <img
                src={photo.image_url}
                alt="Gallery"
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={() => deletePhotoMutation.mutate(photo.id)}
                disabled={deletePhotoMutation.isPending}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading || isAtMax}
            className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Add photo"
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-xs">Add photo</span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ""
            }}
          />
        </div>
        {isAtMax && (
          <p className="text-xs text-muted-foreground">
            Maximum number of photos reached.
          </p>
        )}
      </div>
    </InlineSection>
  )
}
