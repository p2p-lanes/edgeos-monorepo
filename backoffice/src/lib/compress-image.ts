// Client-side image compression for direct-to-storage uploads. Uploads go
// browser -> S3 via presigned PUT, so the backend never sees the bytes and
// this is the only place a resize can happen. Originals arriving at 4-8 MB
// exceed the Next.js image optimizer's 7s upstream fetch timeout in the
// portal, breaking product card images entirely.

// Long edge cap. Largest render is the checkout lightbox (~1200px CSS), so
// 2560 covers 2x DPR with headroom.
const MAX_DIMENSION = 2560
const WEBP_QUALITY = 0.82
// Skip re-encoding only when the image needs no downscale AND is already
// at or below this size; an in-dimension file above it still shrinks
// meaningfully from the WebP re-encode alone.
const SKIP_BYTES = 500 * 1024

// GIFs would lose animation through a canvas; anything non-image (video,
// pdf) passes through untouched.
const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png", "image/webp"]

function replaceExtension(name: string, extension: string): string {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name
  return `${base}.${extension}`
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Downscale and re-encode an image file as WebP before upload. Returns the
 * original file untouched when compression does not apply (non-image, GIF,
 * already small and within dimensions) or would not help (re-encoded output
 * larger than the source). Never throws: on any decode/encode failure the
 * original file is returned so the upload path stays functional.
 */
export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE_TYPES.includes(file.type)) return file

  try {
    // from-image bakes EXIF orientation into the pixels so the re-encoded
    // copy cannot render rotated.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    })

    try {
      const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
      )
      if (scale === 1 && file.size <= SKIP_BYTES) return file

      const canvas = document.createElement("canvas")
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      const blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY)
      if (!blob || blob.size >= file.size) return file

      return new File([blob], replaceExtension(file.name, "webp"), {
        type: "image/webp",
      })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}
