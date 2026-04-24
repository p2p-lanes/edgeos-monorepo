"use client"

import {
  Check,
  Heart,
  HelpCircle,
  Home,
  ImageIcon,
  Play,
  Shield,
  ShoppingBag,
  Ticket,
} from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"

export type FooterDesign = "pill" | "stripe" | "dock"
export type WatermarkStyle = "none" | "ghost" | "stroke" | "bold"

const SECTION_ICONS: Record<string, typeof Ticket> = {
  passes: Ticket,
  housing: Home,
  merch: ShoppingBag,
  patron: Heart,
  confirm: Shield,
}

const TEMPLATE_ICONS: Record<string, typeof Ticket> = {
  "ticket-select": Ticket,
  "patron-preset": Heart,
  "housing-date": Home,
  "merch-image": ShoppingBag,
  "youtube-video": Play,
  "image-gallery": ImageIcon,
  faqs: HelpCircle,
}

function resolveIcon(section: { id: string; template?: string | null }) {
  if (section.template && TEMPLATE_ICONS[section.template]) {
    return TEMPLATE_ICONS[section.template]
  }
  return SECTION_ICONS[section.id] ?? Ticket
}

interface NavSection {
  id: string
  label: string
  template?: string | null
}

interface ScrollySectionNavProps {
  sections: NavSection[]
  activeSection: string
  onSectionClick: (sectionId: string) => void
  extraContent?: ReactNode
}

export default function ScrollySectionNav({
  sections,
  activeSection,
  onSectionClick,
  extraContent,
}: ScrollySectionNavProps) {
  const { isStepComplete } = useCheckout()

  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === activeSection),
  )
  const segmentWidthPct = sections.length > 0 ? 100 / sections.length : 100

  return (
    <div data-snap-nav className="sticky top-0 z-20">
      <div className="bg-checkout-navbar-bg/85 px-2.5 py-1.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-1.5">
          <div className="relative flex-1 overflow-hidden rounded-xl border border-white/10 bg-checkout-badge-bg-disabled/60 p-0.5">
            <div
              aria-hidden
              className="absolute inset-y-0.5 rounded-lg bg-checkout-badge-bg shadow-sm transition-[transform,width] duration-300 ease-out"
              style={{
                width: `calc(${segmentWidthPct}% - 0.125rem)`,
                transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.125}rem))`,
                left: "0.125rem",
              }}
            />
            <div className="relative grid auto-cols-fr grid-flow-col">
              {sections.map((section) => {
                const Icon = resolveIcon(section)
                const isActive = section.id === activeSection
                const isComplete =
                  !isActive && isStepComplete(section.id as CheckoutStep)
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSectionClick(section.id)}
                    aria-current={isActive ? "step" : undefined}
                    className={cn(
                      "relative z-10 flex h-7 min-w-0 items-center justify-center gap-1 px-1.5 text-xs font-semibold transition-colors duration-200",
                      isActive
                        ? "text-checkout-badge-title"
                        : "text-checkout-badge-title-disabled hover:text-checkout-badge-title/80",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="hidden truncate sm:inline">
                      {section.label}
                    </span>
                    {isComplete && (
                      <Check className="size-2.5 text-emerald-400" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          {extraContent ? <div className="shrink-0">{extraContent}</div> : null}
        </div>
      </div>
    </div>
  )
}
