import { AlertCircle, Loader2, Upload } from "lucide-react"
import { useCallback, useState } from "react"

import type { TaskAttachmentCreate } from "@/client"
import { useFileUpload } from "@/hooks/useFileUpload"
import { cn } from "@/lib/utils"

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const VIDEO_TYPES = ["video/mp4"]
const VIDEO_MAX_BYTES = 30 * 1024 * 1024 // 30 MB

interface AttachmentFieldProps {
  onUploaded: (attachment: TaskAttachmentCreate) => void
  disabled?: boolean
}

/**
 * Compact drop/click uploader for task media (screenshots + MP4). On success it
 * hands the caller the attachment metadata (S3 key + public URL); the caller
 * decides whether to persist it immediately (edit) or buffer it (create/report).
 */
export function AttachmentField({
  onUploaded,
  disabled,
}: AttachmentFieldProps) {
  const { uploadFile, uploadProgress, reset, isUploading } = useFileUpload({
    acceptedTypes: [...IMAGE_TYPES, ...VIDEO_TYPES],
    maxSize: VIDEO_MAX_BYTES,
  })
  const [dragActive, setDragActive] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await uploadFile(file)
        onUploaded({
          storage_key: result.key,
          url: result.publicUrl,
          media_type: file.type.startsWith("video/") ? "video" : "image",
          filename: file.name,
          size_bytes: file.size,
        })
        reset()
      } catch {
        // Error surfaced via uploadProgress.
      }
    },
    [uploadFile, onUploaded, reset],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone
    <div
      className={cn(
        "flex min-h-[96px] items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors",
        dragActive && "border-primary bg-primary/5",
        uploadProgress.status === "error" && "border-destructive",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        if (disabled || isUploading) return
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
    >
      {isUploading ? (
        <div className="flex w-full flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Uploading… {uploadProgress.progress}%
          </p>
        </div>
      ) : uploadProgress.status === "error" ? (
        <div className="flex flex-col items-center gap-1">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-xs text-destructive">{uploadProgress.error}</p>
        </div>
      ) : (
        <label
          className={cn(
            "flex flex-col items-center gap-1",
            !disabled && "cursor-pointer",
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Drag & drop or click — screenshot or MP4
          </p>
          <p className="text-[11px] text-muted-foreground">
            PNG, JPG, GIF, WebP up to 10MB · MP4 up to 30MB
          </p>
          <input
            type="file"
            className="hidden"
            accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ""
            }}
          />
        </label>
      )}
    </div>
  )
}
