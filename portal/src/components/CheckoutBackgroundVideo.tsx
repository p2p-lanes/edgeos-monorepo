"use client"

import { useReducedMotion } from "framer-motion"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface CheckoutBackgroundVideoProps {
  url: string
  className?: string
  // TODO: thread a popup-level poster field through when one exists on the
  // popup schema. For now callers can pass a static frame URL explicitly.
  poster?: string
  preload?: "none" | "metadata" | "auto"
}

// Full-bleed `<video>` rendered behind the checkout. Tries autoplay with
// sound; browsers block that without a prior user gesture, so on
// NotAllowedError we restart muted and surface a "Tap for sound" overlay
// the user can click to satisfy the gesture requirement.
//
// Honors `prefers-reduced-motion`: when set, the video does NOT autoplay —
// we render the poster (or first frame) and let the user opt in via the
// play button. This avoids motion-triggered discomfort on entry.
export function CheckoutBackgroundVideo({
  url,
  className,
  poster,
  preload = "metadata",
}: CheckoutBackgroundVideoProps) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(false)
  const [paused, setPaused] = useState(prefersReducedMotion ?? false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (prefersReducedMotion) {
      // Reduced motion: do not autoplay; user can press play.
      el.pause()
      setPaused(true)
      return
    }
    el.muted = false
    el.play().catch(() => {
      el.muted = true
      setMuted(true)
      setAutoplayBlocked(true)
      el.play().catch(() => {
        // Even muted autoplay can fail in obscure setups — give up; the user
        // can press play.
        setPaused(true)
      })
    })
  }, [prefersReducedMotion])

  const enableSound = () => {
    const el = videoRef.current
    if (!el) return
    el.muted = false
    setMuted(false)
    setAutoplayBlocked(false)
    if (el.paused) el.play().catch(() => setPaused(true))
  }

  const toggleMute = () => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
    if (!el.muted) setAutoplayBlocked(false)
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      el.play().catch(() => setPaused(true))
      setPaused(false)
    } else {
      el.pause()
      setPaused(true)
    }
  }

  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: decorative background video, not communicative content */}
      <video
        ref={videoRef}
        src={url}
        poster={poster}
        className={cn(
          "fixed inset-0 w-full h-full object-cover -z-10",
          className,
        )}
        autoPlay={!prefersReducedMotion}
        loop
        playsInline
        preload={preload}
      />
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 pointer-events-none">
        {autoplayBlocked && (
          <button
            type="button"
            onClick={enableSound}
            className="pointer-events-auto rounded-full bg-black/70 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 flex items-center gap-1.5 shadow-md hover:bg-black/80 transition"
          >
            <Volume2 className="w-3.5 h-3.5" />
            {t("checkout.video.tap_for_sound")}
          </button>
        )}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={
            paused
              ? t("checkout.video.play_aria")
              : t("checkout.video.pause_aria")
          }
          className="pointer-events-auto w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition"
        >
          {paused ? (
            <Play className="w-3.5 h-3.5" />
          ) : (
            <Pause className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={
            muted
              ? t("checkout.video.unmute_aria")
              : t("checkout.video.mute_aria")
          }
          className="pointer-events-auto w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition"
        >
          {muted ? (
            <VolumeX className="w-3.5 h-3.5" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </>
  )
}
