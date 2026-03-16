"use client"

import { Check, Heart, Home, Shield, ShoppingBag, Ticket } from "lucide-react"
import { Fragment } from "react"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"

export type NavDesign = "pills" | "progress" | "underline"

const SECTION_ICONS: Record<string, typeof Ticket> = {
  passes: Ticket,
  housing: Home,
  merch: ShoppingBag,
  patron: Heart,
  confirm: Shield,
}

const SHORT_LABELS: Record<string, string> = {
  passes: "Passes",
  housing: "Housing",
  merch: "Merch",
  patron: "Patron",
  confirm: "Review",
}

interface ScrollySectionNavProps {
  sections: { id: string; label: string }[]
  activeSection: string
  onSectionClick: (sectionId: string) => void
  variant?: NavDesign
}

export default function ScrollySectionNav({
  sections,
  activeSection,
  onSectionClick,
  variant = "pills",
}: ScrollySectionNavProps) {
  const { isStepComplete } = useCheckout()

  const getSectionState = (section: { id: string }) => {
    const isActive = section.id === activeSection
    const isComplete = !isActive && isStepComplete(section.id as CheckoutStep)
    return { isActive, isComplete }
  }

  return (
    <div className="sticky top-0 z-20 bg-[#F5F5F7]/95 backdrop-blur-sm border-b border-gray-200/60">
      <div className="max-w-2xl mx-auto px-4 py-2">
        {variant === "pills" && (
          <PillsNav
            sections={sections}
            getSectionState={getSectionState}
            onSectionClick={onSectionClick}
          />
        )}
        {variant === "progress" && (
          <ProgressNav
            sections={sections}
            getSectionState={getSectionState}
            onSectionClick={onSectionClick}
          />
        )}
        {variant === "underline" && (
          <UnderlineNav
            sections={sections}
            getSectionState={getSectionState}
            onSectionClick={onSectionClick}
          />
        )}
      </div>
    </div>
  )
}

interface InnerNavProps {
  sections: { id: string; label: string }[]
  getSectionState: (section: { id: string }) => {
    isActive: boolean
    isComplete: boolean
  }
  onSectionClick: (sectionId: string) => void
}

function PillsNav({
  sections,
  getSectionState,
  onSectionClick,
}: InnerNavProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.id] ?? Ticket
        const { isActive, isComplete } = getSectionState(section)

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSectionClick(section.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200",
              isActive &&
                "bg-white shadow-sm text-gray-900 ring-1 ring-gray-200/80",
              !isActive && !isComplete && "text-gray-500 hover:bg-gray-200/60",
              !isActive && isComplete && "text-gray-600",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="hidden sm:inline">
              {SHORT_LABELS[section.id] ?? section.label}
            </span>
            
          </button>
        )
      })}
    </div>
  )
}

function ProgressNav({
  sections,
  getSectionState,
  onSectionClick,
}: InnerNavProps) {
  return (
    <div className="flex items-center justify-between overflow-x-auto">
      {sections.map((section, i) => {
        const Icon = SECTION_ICONS[section.id] ?? Ticket
        const { isActive, isComplete } = getSectionState(section)
        const prevComplete =
          i > 0 && getSectionState(sections[i - 1]).isComplete

        return (
          <Fragment key={section.id}>
            {i > 0 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-1",
                   "bg-gray-300",
                )}
              />
            )}
            <button
              type="button"
              onClick={() => onSectionClick(section.id)}
              className="flex flex-col items-center gap-1 shrink-0"
            >
              <div
                className={cn(
                  "flex items-center justify-center size-8 rounded-full border-2 transition-all duration-200",
                  isActive && "border-gray-900 bg-gray-900 text-white",
                  !isActive &&
                    "border-gray-300 bg-white text-gray-400",
                )}
              >
                  <Icon className="size-4" />
              </div>
              <span
                className={cn(
                  "hidden sm:block text-[10px] font-medium whitespace-nowrap",
                  isActive && "text-gray-900",
                  !isActive &&  "text-gray-400",
                )}
              >
                {SHORT_LABELS[section.id] ?? section.label}
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

function UnderlineNav({
  sections,
  getSectionState,
  onSectionClick,
}: InnerNavProps) {
  return (
    <div className="flex items-center gap-4 overflow-x-auto relative">
      {sections.map((section) => {
        const { isActive, isComplete } = getSectionState(section)

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSectionClick(section.id)}
            className={cn(
              "relative pb-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 flex items-center gap-1",
              isActive && "text-gray-900",
              isComplete && !isActive && "text-gray-600",
              !isActive && !isComplete && "text-gray-400 hover:text-gray-600",
            )}
          >
            {SHORT_LABELS[section.id] ?? section.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 rounded-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}
