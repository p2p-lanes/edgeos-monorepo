"use client"

import { Settings2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useDesignVariant } from "@/context/designVariant"
import { cn } from "@/lib/utils"
import type { FooterDesign, NavDesign } from "./ScrollySectionNav"

const PANEL_OPEN_KEY = "passes-design-panel-open"

interface DesignVariantPanelProps {
  navDesign: NavDesign
  onNavDesignChange: (value: NavDesign) => void
  footerDesign: FooterDesign
  onFooterDesignChange: (value: FooterDesign) => void
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150",
              value === opt.value
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function DesignVariantPanel({
  navDesign,
  onNavDesignChange,
  footerDesign,
  onFooterDesignChange,
}: DesignVariantPanelProps) {
  const { variant } = useDesignVariant()
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(PANEL_OPEN_KEY)
    if (stored === "true") setIsOpen(true)
  }, [])

  const toggleOpen = () => {
    const next = !isOpen
    setIsOpen(next)
    localStorage.setItem(PANEL_OPEN_KEY, String(next))
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-24 right-4 z-50">
        <button
          type="button"
          onClick={toggleOpen}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 hover:scale-110 transition-transform"
          aria-label="Open design variant panel"
        >
          <Settings2 className="w-5 h-5 text-gray-700" />
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 w-72 bg-white/95 backdrop-blur-sm shadow-xl border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">
          Design Variants
        </span>
        <button
          type="button"
          onClick={toggleOpen}
          className="p-1 rounded-md hover:bg-gray-100 transition-colors"
          aria-label="Close design variant panel"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <SegmentedControl<NavDesign>
          label="Navigation"
          value={navDesign}
          options={[
            { value: "pills", label: "Pills" },
            { value: "progress", label: "Progress" },
            { value: "underline", label: "Line" },
          ]}
          onChange={onNavDesignChange}
        />

        {variant === "snap" && (
          <SegmentedControl<FooterDesign>
            label="Footer"
            value={footerDesign}
            options={[
              { value: "pill", label: "Pill" },
              { value: "stripe", label: "Stripe" },
              { value: "dock", label: "Dock" },
            ]}
            onChange={onFooterDesignChange}
          />
        )}
      </div>
    </div>
  )
}
