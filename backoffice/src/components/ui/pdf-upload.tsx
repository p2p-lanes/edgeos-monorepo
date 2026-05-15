import { AlertCircle, FileText, Loader2, Upload, X } from "lucide-react"
import { useCallback, useState } from "react"

import { useFileUpload } from "@/hooks/useFileUpload"
import { cn } from "@/lib/utils"
import { Button } from "./button"

const PDF_TYPES = ["application/pdf"]

interface PdfUploadProps {
  value?: string | null
  onChange: (url: string | null) => void
  className?: string
  disabled?: boolean
}

export function PdfUpload({
  value,
  onChange,
  className,
  disabled,
}: PdfUploadProps) {
  const { uploadFile, uploadProgress, reset, isUploading } = useFileUpload({
    acceptedTypes: PDF_TYPES,
  })
  const [dragActive, setDragActive] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await uploadFile(file)
        onChange(result.publicUrl)
      } catch {
        // surfaced by uploadProgress.status === "error"
      }
    },
    [uploadFile, onChange],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      if (disabled || isUploading) return
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [disabled, isUploading, handleFile],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ""
    },
    [handleFile],
  )

  const handleRemove = useCallback(() => {
    onChange(null)
    reset()
  }, [onChange, reset])

  if (value) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2",
          className,
        )}
      >
        <FileText className="h-4 w-4 text-muted-foreground" />
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 truncate text-sm text-primary underline"
        >
          View uploaded PDF
        </a>
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove PDF"
            className="h-7 w-7"
            onClick={handleRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-6 text-center transition-colors min-h-[120px] flex items-center justify-center",
        dragActive && "border-primary bg-primary/5",
        uploadProgress.status === "error" && "border-destructive",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Uploading… {uploadProgress.progress}%
          </p>
        </div>
      ) : uploadProgress.status === "error" ? (
        <div className="flex flex-col items-center gap-2">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">{uploadProgress.error}</p>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Try Again
          </Button>
        </div>
      ) : (
        <label
          className={cn(
            "flex flex-col items-center gap-2",
            !disabled && "cursor-pointer",
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drag & drop a PDF or click to upload
          </p>
          <p className="text-xs text-muted-foreground">PDF up to 10MB</p>
          <input
            type="file"
            className="hidden"
            accept="application/pdf"
            onChange={handleChange}
            disabled={disabled}
          />
        </label>
      )}
    </div>
  )
}
