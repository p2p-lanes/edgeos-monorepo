import { Loader2 } from "lucide-react"
import { useCallback, useState } from "react"
import Cropper, { type Area } from "react-easy-crop"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface CoverImageCropperProps {
  /** Object URL or blob URL of the picked image. */
  src: string
  /** Aspect ratio of the cropped output (width / height). */
  aspect?: number
  open: boolean
  onCancel: () => void
  onConfirm: (blob: Blob) => void
  saving?: boolean
}

/**
 * Draws the given source image onto a canvas using the pixel area returned
 * by react-easy-crop, returning a JPEG blob with the cropped region.
 */
async function cropImage(src: string, area: Area): Promise<Blob> {
  const image = await loadImage(src)
  const canvas = document.createElement("canvas")
  canvas.width = area.width
  canvas.height = area.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.9,
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function CoverImageCropper({
  src,
  aspect = 16 / 9,
  open,
  onCancel,
  onConfirm,
  saving = false,
}: CoverImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [pixelArea, setPixelArea] = useState<Area | null>(null)
  const [working, setWorking] = useState(false)

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setPixelArea(pixels)
  }, [])

  const handleConfirm = async () => {
    if (!pixelArea) return
    setWorking(true)
    try {
      const blob = await cropImage(src, pixelArea)
      onConfirm(blob)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adjust cover image</DialogTitle>
        </DialogHeader>
        <div className="relative h-80 w-full bg-muted">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-16">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!pixelArea || working || saving}
          >
            {(working || saving) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
