"use client"

/**
 * Every photo of a room, one at a time.
 *
 * The step itself only ever shows a cover: a board is for comparing rooms,
 * and a room that spends six photos arguing for itself on the board takes
 * the space the next room needed to be seen at all. So the rest of the
 * photography lives here, behind the room's own screen, where there is one
 * room to look at and the whole width to look at it in.
 *
 * No carousel library. What a gallery of five photos needs is an index, two
 * buttons, a thumbnail strip and the arrow keys, and every one of those is
 * cheaper written than configured.
 */

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react"
import Image from "next/image"
import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { AccommodationImagePublic } from "@/client"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"

interface RoomGalleryProps {
  images: AccommodationImagePublic[]
  /** The room's name: every photo here is a photo of it. */
  alt: string
  className?: string
}

/** How far a thumb has to travel before it counts as a swipe and not a tap. */
const SWIPE_THRESHOLD = 48

export function RoomGallery({ images, alt, className }: RoomGalleryProps) {
  const { t } = useTranslation()
  // Reset per room by being remounted, not by an effect: the caller keys
  // this on the room, because the dialog around it is mounted once and
  // re-pointed, and a gallery left on photo 5 must not open the next room
  // past the end of its photos.
  const [index, setIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const count = images.length

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return
      setIndex((current) => (current + delta + count) % count)
    },
    [count],
  )

  if (count === 0) {
    return (
      <div
        className={cn(
          "flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageOff aria-hidden className="h-6 w-6" />
        <span className="text-xs">
          {t("checkout.accommodation.gallery.no_photos")}
        </span>
      </div>
    )
  }

  const current = images[index]

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* The arrow keys reach this by bubbling from the buttons inside it,
          which are the focusable things; the region is never a tab stop. */}
      <section
        aria-roledescription="carousel"
        aria-label={alt}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            go(-1)
          }
          if (event.key === "ArrowRight") {
            event.preventDefault()
            go(1)
          }
        }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current
          touchStartX.current = null
          if (start === null) return
          const travelled = (event.changedTouches[0]?.clientX ?? start) - start
          if (Math.abs(travelled) < SWIPE_THRESHOLD) return
          go(travelled < 0 ? 1 : -1)
        }}
        className="relative aspect-[16/10] w-full overflow-hidden bg-muted"
      >
        <Image
          key={current.url}
          src={current.url}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover"
          priority={index === 0}
          {...imageOptimization(current.url)}
        />

        {count > 1 && (
          <>
            <GalleryArrow
              side="left"
              label={t("checkout.accommodation.gallery.previous")}
              onClick={() => go(-1)}
            />
            <GalleryArrow
              side="right"
              label={t("checkout.accommodation.gallery.next")}
              onClick={() => go(1)}
            />
            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
              {t("checkout.accommodation.gallery.position", {
                current: index + 1,
                total: count,
              })}
            </span>
          </>
        )}
      </section>

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-1">
          {images.map((image, position) => (
            <button
              key={image.id}
              type="button"
              aria-label={t("checkout.accommodation.gallery.go_to", {
                number: position + 1,
              })}
              aria-current={position === index}
              onClick={() => setIndex(position)}
              className={cn(
                "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity",
                position === index
                  ? "border-primary"
                  : "border-transparent opacity-60 hover:opacity-100",
              )}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                {...imageOptimization(image.url)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GalleryArrow({
  side,
  label,
  onClick,
}: {
  side: "left" | "right"
  label: string
  onClick: () => void
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-md transition hover:bg-white",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon aria-hidden className="h-5 w-5" />
    </button>
  )
}
