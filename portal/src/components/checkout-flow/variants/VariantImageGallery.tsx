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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface GalleryImage {
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
  return <p className="text-sm text-gray-600 text-center mt-2">{text}</p>
}

// ---------------------------------------------------------------------------
// Carousel
// ---------------------------------------------------------------------------

function CarouselGallery({
  images,
  onSkip,
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
      <div className="relative overflow-hidden rounded-2xl bg-gray-100">
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
                  className="object-cover"
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
                i === current ? "bg-gray-800" : "bg-gray-300",
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
// Masonry
// ---------------------------------------------------------------------------

function MasonryGallery({
  images,
  onSkip,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="columns-2 sm:columns-3 gap-3 space-y-3">
        {images.map((img) => (
          <div key={img.id} className="break-inside-avoid">
            <div className="rounded-xl overflow-hidden shadow-sm border border-gray-100">
              {/* biome-ignore lint: masonry items use native img for natural height */}
              <img
                src={img.url}
                alt={img.caption || ""}
                className="w-full h-auto block"
                loading="lazy"
              />
              {img.caption && (
                <div className="px-3 py-2">
                  <p className="text-xs text-gray-600">{img.caption}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function LightboxGallery({
  images,
  onSkip,
}: {
  images: GalleryImage[]
  onSkip?: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  const close = useCallback(() => setSelected(null), [])
  const prev = useCallback(
    () =>
      setSelected((i) =>
        i !== null ? (i > 0 ? i - 1 : images.length - 1) : null,
      ),
    [images.length],
  )
  const next = useCallback(
    () =>
      setSelected((i) =>
        i !== null ? (i < images.length - 1 ? i + 1 : 0) : null,
      ),
    [images.length],
  )

  useEffect(() => {
    if (selected === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
      if (e.key === "ArrowLeft") prev()
      if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selected, close, prev, next])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setSelected(i)}
            className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group"
          >
            <Image
              src={img.url}
              alt={img.caption || ""}
              fill
              className="object-cover transition-transform duration-200 group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      {selected !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
          onKeyDown={() => {}}
          role="dialog"
        >
          <button
            type="button"
            onClick={close}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={next}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}

          <div className="max-w-4xl max-h-[80vh] w-full mx-4 relative">
            <Image
              src={images[selected].url}
              alt={images[selected].caption || ""}
              width={1200}
              height={800}
              className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
            />
            {images[selected].caption && (
              <p className="text-white/80 text-sm text-center mt-3">
                {images[selected].caption}
              </p>
            )}
            <p className="text-white/50 text-xs text-center mt-1">
              {selected + 1} / {images.length}
            </p>
          </div>
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Slideshow
// ---------------------------------------------------------------------------

function SlideshowGallery({
  images,
  onSkip,
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
      <div className="relative rounded-2xl overflow-hidden bg-gray-100 aspect-[16/9]">
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
                i === current ? "bg-gray-800" : "bg-gray-300",
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
  const images = parseImages(templateConfig)
  const variant = (templateConfig?.variant as string) || "carousel"

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ImageIcon className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No images available for this step.</p>
        <Button variant="outline" onClick={onSkip}>
          Continue
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
