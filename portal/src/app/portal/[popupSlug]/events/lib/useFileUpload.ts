"use client"

import { useCallback, useState } from "react"
import { UploadsService } from "@/client"

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"]

export interface UploadResult {
  publicUrl: string
  key: string
}

/**
 * Small wrapper around the /uploads/presigned-url flow for the portal.
 * Mirrors backoffice/src/hooks/useFileUpload.ts so both sides share the
 * same validation + sequencing.
 */
export function useFileUpload() {
  const [isUploading, setUploading] = useState(false)

  const uploadFile = useCallback(async (file: File): Promise<UploadResult> => {
    if (!ALLOWED.includes(file.type)) {
      throw new Error(`Invalid file type. Allowed: ${ALLOWED.join(", ")}`)
    }
    if (file.size > MAX_SIZE) {
      throw new Error(
        `File too large. Max ${Math.round(MAX_SIZE / 1024 / 1024)} MB`,
      )
    }

    setUploading(true)
    try {
      const { upload_url, public_url, key } =
        await UploadsService.getPresignedUploadUrl({
          requestBody: { filename: file.name, content_type: file.type },
        })

      const res = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`)
      }
      return { publicUrl: public_url, key }
    } finally {
      setUploading(false)
    }
  }, [])

  return { uploadFile, isUploading }
}
