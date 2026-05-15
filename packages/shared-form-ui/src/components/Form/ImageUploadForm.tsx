"use client"

import { AlertCircle, Image as ImageIcon, Loader2, Upload, X } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import type { ImageUploadConfig } from "../../types"
import { cn } from "../../utils"
import { useFileUploadFn } from "../FileUploadProvider"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelMuted, LabelRequired } from "../Label"

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED = "image/jpeg,image/png,image/gif,image/webp"

export interface ImageUploadFormProps {
  id: string
  label?: string
  subtitle?: string
  config?: ImageUploadConfig
  value?: string
  onChange?: (value: string) => void
  error?: string
  isRequired?: boolean
  disabled?: boolean
  readOnly?: boolean
}

export function ImageUploadForm({
  id,
  label,
  subtitle,
  config,
  value,
  onChange,
  error,
  isRequired,
  disabled,
  readOnly,
}: ImageUploadFormProps) {
  const uploadFn = useFileUploadFn()
  const [uploading, setUploading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const buttonText = config?.button_text || "Upload image"

  const isInteractive = !disabled && !readOnly && !!uploadFn

  const handleFile = useCallback(
    async (file: File) => {
      if (!uploadFn) return
      setLocalError(null)
      if (!file.type.startsWith("image/")) {
        setLocalError("File must be an image")
        return
      }
      if (file.size > MAX_SIZE) {
        setLocalError(`Image too large (max ${MAX_SIZE / 1024 / 1024} MB)`)
        return
      }
      setUploading(true)
      try {
        const result = await uploadFn(file)
        onChange?.(result.publicUrl)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setUploading(false)
      }
    },
    [uploadFn, onChange],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (f) handleFile(f)
      e.target.value = ""
    },
    [handleFile],
  )

  const handleRemove = useCallback(() => {
    onChange?.("")
    setLocalError(null)
  }, [onChange])

  const displayError = error || localError

  return (
    <FormInputWrapper>
      {label && <LabelRequired isRequired={isRequired}>{label}</LabelRequired>}
      {subtitle && (
        <LabelMuted className="text-sm text-muted-foreground">
          {subtitle}
        </LabelMuted>
      )}

      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Uploaded preview"
            className="max-h-48 max-w-full rounded-lg border object-contain"
          />
          {isInteractive && (
            <button
              type="button"
              aria-label="Remove image"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : readOnly ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
          <ImageIcon className="mr-2 h-5 w-5" />
          <span className="text-sm">Image will appear here</span>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed p-6",
            !isInteractive && "opacity-60",
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Uploading…</span>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!isInteractive}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm",
                  isInteractive
                    ? "hover:bg-muted"
                    : "cursor-not-allowed",
                )}
                title={
                  !uploadFn
                    ? "Uploads are not available in this view"
                    : undefined
                }
              >
                <Upload className="h-4 w-4" />
                {buttonText}
              </button>
              <input
                ref={fileInputRef}
                id={id}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={onInputChange}
                disabled={!isInteractive}
              />
              <p className="text-xs text-muted-foreground">
                PNG, JPG, GIF, WebP up to 10MB
              </p>
            </>
          )}
        </div>
      )}

      {displayError && (
        <p className="text-red-500 text-sm flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {displayError}
        </p>
      )}
    </FormInputWrapper>
  )
}
