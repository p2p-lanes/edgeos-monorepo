"use client"

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
    const watermarkText = watermark ?? title
    const watermarkClassName = cn(
      "absolute sm:-top-8 left-0 sm:text-[7rem] -top-4 text-[5rem] font-black leading-none select-none pointer-events-none truncate whitespace-nowrap z-[5]",
      watermarkStyle === "none" && "text-white",
      watermarkStyle === "ghost" && "text-gray-100",
      watermarkStyle === "stroke" && "text-white",
      watermarkStyle === "bold" && "text-gray-200",
    )
    const watermarkInlineStyle =
      watermarkStyle === "stroke"
        ? { WebkitTextStroke: "1px #d1d5db" }
        : undefined
    return (
      <>
        <div className="mb-8">
          <div className="relative min-h-[2rem] sm:min-h-[3rem]">
            {showWatermark && (
              <p
                aria-hidden="true"
                className={watermarkClassName}
                style={watermarkInlineStyle}
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
                className="relative text-2xl sm:text-4xl font-bold tracking-tight text-heading z-10 drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]"
              >
                {title}
              </h2>
            )}
          </div>
        </div>
        {subtitle && (
          <p
            data-section-subtitle
            className="text-base sm:text-lg text-heading-secondary my-2 rounded px-1 w-fit"
          >
            {subtitle}
          </p>
        )}
      </>
    )
  }

  return (
    <div className="mb-4">
      {showTitle && (
        <h2 className="text-xl font-bold tracking-tight text-heading">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="text-sm text-heading-secondary mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}
