"use client"

import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Pause,
  Play,
  X,
} from "lucide-react"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export interface GalleryImage {
  id: string
  url: string
  caption?: string
}

function parseImages(
  templateConfig: VariantProps["templateConfig"],
): GalleryImage[] {
  const raw = templateConfig?.images
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw as GalleryImage[]
}

function Caption({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p className="text-sm text-muted-foreground text-center mt-2">{text}</p>
  )
}

// ---------------------------------------------------------------------------
// Shared lightbox overlay — full-screen image preview with prev/next +
// keyboard nav. Both Masonry and Lightbox layouts mount this on click so
// the masonry visual stays intact while gaining click-to-expand. Parent
// controls open/close by mounting/unmounting; passing a fresh `key` lets
// the parent jump to a different image without going through close first.
// ---------------------------------------------------------------------------

export function LightboxOverlay({
  images,
  initialIndex,
  onClose,
}: {
  images: GalleryImage[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)

  const prev = useCallback(
    () => setIndex((i) => (i > 0 ? i - 1 : images.length - 1)),
    [images.length],
  )
  const next = useCallback(
    () => setIndex((i) => (i < images.length - 1 ? i + 1 : 0)),
    [images.length],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft") prev()
      if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, prev, next])

  const current = images[index]
  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={() => {}}
      role="dialog"
      aria-modal="true"
      aria-label={current.caption || `Image ${index + 1} of ${images.length}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
      >
        <X className="w-5 h-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next image"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      <div className="max-w-4xl max-h-[80vh] w-full mx-4 relative">
        <Image
          src={current.url}
          alt={current.caption || ""}
          width={1200}
          height={800}
          className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
          {...imageOptimization(current.url)}
        />
        {current.caption && (
          <p className="text-white/80 text-sm text-center mt-3">
            {current.caption}
          </p>
        )}
        <p className="text-white/50 text-xs text-center mt-1">
          {index + 1} / {images.length}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carousel
// ---------------------------------------------------------------------------

function CarouselGallery({
  images,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  const [current, setCurrent] = useState(0)
  const touchStartX = useRef(0)

  const prev = () => setCurrent((i) => (i > 0 ? i - 1 : images.length - 1))
  const next = () => setCurrent((i) => (i < images.length - 1 ? i + 1 : 0))

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-muted">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX
          }}
          onTouchEnd={(e) => {
            const delta = touchStartX.current - e.changedTouches[0].clientX
            if (Math.abs(delta) > 50) {
              if (delta > 0) next()
              else prev()
            }
          }}
        >
          {images.map((img) => (
            <div key={img.id} className="w-full shrink-0">
              <div className="relative w-full aspect-[16/9]">
                <Image
                  src={img.url}
                  alt={img.caption || ""}
                  fill
                  sizes="(max-width: 768px) 100vw, 672px"
                  className="object-cover"
                  {...imageOptimization(img.url)}
                />
              </div>
            </div>
          ))}
        </div>

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setCurrent(i)}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                i === current ? "bg-foreground" : "bg-muted",
              )}
            />
          ))}
        </div>
      )}

      <Caption text={images[current]?.caption} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Masonry — staggered grid with full-screen preview on click
// ---------------------------------------------------------------------------

function MasonryGallery({
  images,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <div className="columns-2 sm:columns-3 gap-3 space-y-3">
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setSelected(i)}
            className="break-inside-avoid w-full block cursor-zoom-in"
            aria-label={img.caption || `View image ${i + 1}`}
          >
            <div className="rounded-xl overflow-hidden shadow-sm border border-border group">
              {/* Masonry items keep their natural height: width/height are
                  zeroed and CSS (w-full h-auto) drives layout. */}
              <Image
                src={img.url}
                alt={img.caption || ""}
                width={0}
                height={0}
                sizes="(max-width: 640px) 50vw, 33vw"
                className="w-full h-auto block transition-transform duration-200 group-hover:scale-[1.02]"
                {...imageOptimization(img.url)}
              />
              {img.caption && (
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">{img.caption}</p>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {selected !== null && (
        <LightboxOverlay
          // `key` forces a fresh mount whenever the parent opens with a
          // different starting image, so the overlay's internal index
          // initializes to that thumbnail instead of carrying the old one.
          key={selected}
          images={images}
          initialIndex={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lightbox — square thumbnail grid with full-screen preview on click
// ---------------------------------------------------------------------------

function LightboxGallery({
  images,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setSelected(i)}
            className="relative aspect-square rounded-xl overflow-hidden bg-muted group cursor-zoom-in"
            aria-label={img.caption || `View image ${i + 1}`}
          >
            <Image
              src={img.url}
              alt={img.caption || ""}
              fill
              sizes="(max-width: 640px) 50vw, 224px"
              className="object-cover transition-transform duration-200 group-hover:scale-105"
              {...imageOptimization(img.url)}
            />
          </button>
        ))}
      </div>

      {selected !== null && (
        <LightboxOverlay
          key={selected}
          images={images}
          initialIndex={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slideshow
// ---------------------------------------------------------------------------

function SlideshowGallery({
  images,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing || images.length <= 1) return
    const timer = setInterval(() => {
      setCurrent((i) => (i < images.length - 1 ? i + 1 : 0))
    }, 4000)
    return () => clearInterval(timer)
  }, [playing, images.length])

  return (
    <div className="space-y-4">
      <div className="relative rounded-2xl overflow-hidden bg-muted aspect-[16/9]">
        {images.map((img, i) => (
          <div
            key={img.id}
            className={cn(
              "absolute inset-0 transition-opacity duration-1000",
              i === current ? "opacity-100" : "opacity-0",
            )}
          >
            <Image
              src={img.url}
              alt={img.caption || ""}
              fill
              className="object-cover"
            />
          </div>
        ))}

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors z-10"
          >
            {playing ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                setCurrent(i)
                setPlaying(false)
              }}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                i === current ? "bg-foreground" : "bg-muted",
              )}
            />
          ))}
        </div>
      )}

      <Caption text={images[current]?.caption} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function VariantImageGallery({
  onSkip,
  templateConfig,
}: VariantProps) {
  const { t } = useTranslation()
  const images = parseImages(templateConfig)
  const variant = (templateConfig?.variant as string) || "carousel"

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ImageIcon className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-6">{t("checkout.no_images")}</p>
        <Button variant="outline" onClick={onSkip}>
          {t("common.continue")}
        </Button>
      </div>
    )
  }

  const VARIANT_MAP: Record<string, typeof CarouselGallery> = {
    carousel: CarouselGallery,
    masonry: MasonryGallery,
    lightbox: LightboxGallery,
    slideshow: SlideshowGallery,
  }

  const Layout = VARIANT_MAP[variant] ?? CarouselGallery

  return <Layout images={images} onSkip={onSkip} />
}
