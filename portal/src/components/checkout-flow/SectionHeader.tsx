"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { WatermarkStyle } from "./ScrollySectionNav"

export default function SectionHeader({
  title,
  subtitle,
  variant,
  watermark,
  watermarkStyle = "none",
  showTitle = true,
  showWatermark = true,
}: {
  title: string
  subtitle?: string
  variant?: string
  watermark?: string
  watermarkStyle?: WatermarkStyle
  showTitle?: boolean
  showWatermark?: boolean
}) {
  if (variant === "snap") {
    return (
      <SnapSectionHeader
        title={title}
        subtitle={subtitle}
        watermark={watermark}
        watermarkStyle={watermarkStyle}
        showTitle={showTitle}
        showWatermark={showWatermark}
      />
    )
  }

  return (
    <div className="mb-4">
      {showTitle && (
        <h2 className="text-xl font-bold tracking-tight text-checkout-title">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-checkout-subtitle mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}

function SnapSectionHeader({
  title,
  subtitle,
  watermark,
  watermarkStyle,
  showTitle,
  showWatermark,
}: {
  title: string
  subtitle?: string
  watermark?: string
  watermarkStyle: WatermarkStyle
  showTitle: boolean
  showWatermark: boolean
}) {
  const watermarkText = watermark ?? title
  // All variants use the themed checkout_watermark_color. The user-configured
  // alpha controls the watermark's visual weight; the `style` variants live on
  // for future tweaks (e.g. stroke) but no longer hardcode gray/white.
  const watermarkClassName = cn(
    "absolute sm:-top-8 left-0 sm:text-[7rem] -top-4 text-[5rem] font-black leading-none select-none pointer-events-none whitespace-nowrap z-[5] text-checkout-watermark",
  )
  const watermarkInlineStyle =
    watermarkStyle === "stroke"
      ? { WebkitTextStroke: "1px currentColor" }
      : undefined

  const wrapperRef = useRef<HTMLDivElement>(null)
  const watermarkRef = useRef<HTMLParagraphElement>(null)
  const [watermarkScale, setWatermarkScale] = useState(1)

  useLayoutEffect(() => {
    const fit = () => {
      const p = watermarkRef.current
      const wrap = wrapperRef.current
      if (!p || !wrap || watermarkText.length === 0) return
      const prevTransform = p.style.transform
      p.style.transform = "none"
      const natural = p.getBoundingClientRect().width
      const available = wrap.getBoundingClientRect().width
      p.style.transform = prevTransform
      setWatermarkScale(
        natural > 0 && natural > available ? available / natural : 1,
      )
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    if (watermarkRef.current) ro.observe(watermarkRef.current)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) fonts.ready.then(fit).catch(() => {})
    return () => ro.disconnect()
  }, [watermarkText])

  return (
    <>
      <div className="mb-8">
        <div ref={wrapperRef} className="relative min-h-[2rem] sm:min-h-[3rem]">
          {showWatermark && (
            <p
              ref={watermarkRef}
              aria-hidden="true"
              className={watermarkClassName}
              style={{
                ...watermarkInlineStyle,
                transform: `scale(${watermarkScale})`,
                transformOrigin: "top left",
              }}
            >
              {watermarkText.split("").map((char, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static decorative chars
                  key={i}
                  data-watermark-char
                  style={{ display: "inline-block" }}
                >
                  {char === " " ? "\u00A0" : char}
                </span>
              ))}
            </p>
          )}
          {showTitle && (
            <h2
              data-section-title
              className="relative text-2xl sm:text-4xl font-bold tracking-tight text-checkout-title z-10 drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]"
            >
              {title}
            </h2>
          )}
        </div>
      </div>
      {subtitle && (
        <p
          data-section-subtitle
          className="text-base sm:text-lg text-checkout-subtitle my-2 rounded px-1 w-fit"
        >
          {subtitle}
        </p>
      )}
    </>
  )
}
