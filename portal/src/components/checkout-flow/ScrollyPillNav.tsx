"use client"

import { Check } from "lucide-react"
import Image from "next/image"
import type { ReactNode } from "react"
import { getRegistryIcon, resolveStepIcon } from "@/lib/checkoutStepIcons"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"

interface NavSection {
  id: string
  label: string
  template?: string | null
  emoji?: string | null
}

interface ScrollyPillNavProps {
  sections: NavSection[]
  activeSection: string
  onSectionClick: (sectionId: string) => void
  extraContent?: ReactNode
  brandLogoUrl?: string | null
  brandLabel?: string
}

const resolveIcon = (section: { id: string; template?: string | null }) =>
  resolveStepIcon({ stepType: section.id, template: section.template })

// Pills nav variant — individually-bordered pills in a horizontally scrollable
// row, matching the amanita mockup. Colors are theme-driven; business state
// (complete / incomplete) mirrors ScrollySectionNav's segmented variant.
export default function ScrollyPillNav({
  sections,
  activeSection,
  onSectionClick,
  extraContent,
  brandLogoUrl,
  brandLabel,
}: ScrollyPillNavProps) {
  const {
    isStepComplete,
    visitedSteps,
    isBuyerInfoComplete,
    forcedBuyerFieldsTouched,
  } = useCheckout()

  const isStepIncomplete = (stepId: string): boolean => {
    if (stepId === "buyer") {
      if (isBuyerInfoComplete) return false
      const surfacedByForce = forcedBuyerFieldsTouched.size > 0
      return surfacedByForce || visitedSteps.has(stepId)
    }
    return false
  }

  return (
    <div data-snap-nav className="sticky top-0 z-20">
      <div
        className="bg-checkout-navbar-bg/85 px-2.5 py-2 backdrop-blur-xl"
        style={{ backgroundImage: "var(--checkout-navbar-image, none)" }}
      >
        <div className="flex items-center gap-1.5">
          {brandLogoUrl ? (
            <Image
              src={brandLogoUrl}
              alt={brandLabel ?? "Tenant logo"}
              width={28}
              height={28}
              priority
              className="size-7 shrink-0 rounded-md object-contain"
              {...imageOptimization(brandLogoUrl)}
            />
          ) : null}
          <nav
            aria-label="Checkout sections"
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] md:justify-center [&::-webkit-scrollbar]:hidden"
          >
            {sections.map((section) => {
              const Icon = resolveIcon(section)
              const isActive = section.id === activeSection
              const isComplete =
                !isActive && isStepComplete(section.id as CheckoutStep)
              const isIncomplete = !isActive && isStepIncomplete(section.id)
              const emoji = section.emoji?.trim()
              const RegistryIcon = getRegistryIcon(emoji)
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSectionClick(section.id)}
                  aria-current={isActive ? "step" : undefined}
                  aria-invalid={isIncomplete || undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition-colors",
                    isActive
                      ? "bg-checkout-badge-bg text-checkout-badge-title border-checkout-badge-border"
                      : isIncomplete
                        ? "border-amber-400/50 text-amber-400 hover:text-amber-300"
                        : "border-checkout-navbar-border text-checkout-badge-title-disabled hover:opacity-70",
                  )}
                >
                  {RegistryIcon ? (
                    <RegistryIcon className="size-3.5 shrink-0" />
                  ) : emoji ? (
                    <span
                      aria-hidden
                      style={{
                        filter:
                          "var(--checkout-nav-emoji-filter, none)" as string,
                      }}
                      className="text-sm leading-none shrink-0"
                    >
                      {emoji}
                    </span>
                  ) : (
                    <Icon className="size-3.5 shrink-0" />
                  )}
                  <span>{section.label}</span>
                  {isComplete && (
                    <Check className="size-2.5 text-emerald-400" />
                  )}
                </button>
              )
            })}
          </nav>
          {extraContent ? <div className="shrink-0">{extraContent}</div> : null}
        </div>
      </div>
    </div>
  )
}
