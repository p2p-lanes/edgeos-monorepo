import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"

import { AccommodationsService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { useFileUpload } from "@/hooks/useFileUpload"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

/**
 * The popup-wide photo bank.
 *
 * Photos are uploaded once and linked to any number of room types, so a
 * property's shared shots (the pool, the lobby) are not re-uploaded for every
 * room. The upload itself goes through the usual /uploads flow; this tab only
 * records the resulting URL so it can be reused.
 */
export function PhotosTab({ popupId }: { popupId: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { uploadFile, isUploading } = useFileUpload()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const { data } = useQuery({
    queryKey: ["accommodations", "images", popupId],
    queryFn: () => AccommodationsService.listImages({ popupId }),
    enabled: !!popupId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["accommodations", "images", popupId],
    })

  const register = useMutation({
    mutationFn: async (files: File[]) => {
      // Sequential on purpose: the uploader reports one progress state, and a
      // parallel burst would make it flicker meaninglessly.
      for (const file of files) {
        const { publicUrl } = await uploadFile(file)
        await AccommodationsService.createImage({
          requestBody: {
            popup_id: popupId,
            url: publicUrl,
            filename: file.name,
          },
        })
      }
      return files.length
    },
    onSuccess: (count) => {
      showSuccessToast(`${count} photo${count === 1 ? "" : "s"} added`)
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const remove = useMutation({
    mutationFn: (imageId: string) =>
      AccommodationsService.deleteImage({ imageId }),
    onSuccess: () => {
      showSuccessToast("Photo removed")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    register.mutate(Array.from(files))
  }

  const busy = isUploading || register.isPending

  if (!data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          handleFiles(event.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
          busy && "opacity-60",
        )}
        disabled={busy}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm font-medium">
          {busy ? "Uploading…" : "Drop photos here or click to browse"}
        </span>
        <span className="text-xs text-muted-foreground">
          Photos land in this gathering's library and can be assigned to any
          room.
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ""
        }}
      />

      {data.results.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No photos yet"
          description="Upload the property's photos once and reuse them across every room type."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {data.results.map((image) => (
            <div
              key={image.id}
              className="group relative aspect-square overflow-hidden rounded-lg border"
            >
              <img
                src={image.url}
                alt={image.filename ?? ""}
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                aria-label={`Remove ${image.filename ?? "photo"}`}
                className="absolute right-1 top-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                disabled={remove.isPending}
                onClick={() => remove.mutate(image.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
