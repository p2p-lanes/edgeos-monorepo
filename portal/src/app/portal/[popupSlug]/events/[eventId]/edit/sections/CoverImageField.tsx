"use client"

import { Loader2, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CoverImageCropper } from "@/components/CoverImageCropper"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useFileUpload } from "../../../lib/useFileUpload"

interface CoverImageFieldProps {
  coverUrl: string
  onChange: (next: string) => void
}

export function CoverImageField({ coverUrl, onChange }: CoverImageFieldProps) {
  const { t } = useTranslation()
  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingCrop, setPendingCrop] = useState<{
    url: string
    name: string
  } | null>(null)

  const onPickFile = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    setPendingCrop({ url: URL.createObjectURL(file), name: file.name })
  }

  const handleCropConfirm = async (blob: Blob) => {
    if (!pendingCrop) return
    try {
      const file = new File(
        [blob],
        pendingCrop.name.replace(/\.\w+$/, ".jpg"),
        { type: "image/jpeg" },
      )
      const { publicUrl } = await uploadFile(file)
      onChange(publicUrl)
      toast.success(t("events.form.image_uploaded_success"))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      URL.revokeObjectURL(pendingCrop.url)
      setPendingCrop(null)
    }
  }

  const handleCropCancel = () => {
    if (pendingCrop) URL.revokeObjectURL(pendingCrop.url)
    setPendingCrop(null)
  }

  return (
    <div className="space-y-2">
      <Label>{t("events.form.cover_image_label_edit")}</Label>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={(e) => {
          onPickFile(e.target.files)
          e.target.value = ""
        }}
      />
      {coverUrl ? (
        <div className="relative w-full overflow-hidden rounded-lg border">
          {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
          <img
            src={coverUrl}
            alt={t("events.form.event_cover_alt")}
            className="aspect-[16/9] w-full object-cover"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1 h-4 w-4" />{" "}
              {t("events.form.replace_button")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onChange("")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={isUploading}
            onClick={() => fileRef.current?.click()}
          >
            {isUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {isUploading
              ? t("events.form.uploading_button")
              : t("events.form.upload_image_button")}
          </Button>
        </div>
      )}

      {pendingCrop && (
        <CoverImageCropper
          src={pendingCrop.url}
          open={true}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
          saving={isUploading}
        />
      )}
    </div>
  )
}
