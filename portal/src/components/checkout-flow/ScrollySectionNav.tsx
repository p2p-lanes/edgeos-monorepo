"use client"

import {
  Check,
  CircleUser,
  Film,
  Heart,
  HelpCircle,
  Home,
  ImageIcon,
  ParkingSquare,
  Play,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Tent,
  Ticket,
  User,
} from "lucide-react"
import type { ComponentType, ReactNode, SVGProps } from "react"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"

export type FooterDesign = "pill" | "stripe" | "dock"
export type WatermarkStyle = "none" | "ghost" | "stroke" | "bold"

// Custom mushroom icon — Lucide doesn't ship one, so we trace a tiny inline
// SVG that follows the same stroke style (currentColor, 2px stroke,
// rounded caps) and slots cleanly next to the other Lucide icons.
function MushroomIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Cap: half-dome covering the top */}
      <path d="M3 12a9 4 0 0 1 18 0v0a0 0 0 0 1 0 0H3a0 0 0 0 1 0 0Z" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      {/* Stem */}
      <path d="M10 12v6a2 2 0 0 0 4 0v-6" />
      {/* Spots */}
      <circle cx="9" cy="9" r="0.6" fill="currentColor" />
      <circle cx="14" cy="7.5" r="0.6" fill="currentColor" />
      <circle cx="17" cy="10" r="0.6" fill="currentColor" />
    </svg>
  )
}

/** Curated icon registry. Tenants set `step.emoji` to one of these slug
 * names (`"user"`, `"mushroom"`, `"tent"`, …) and the nav renders the
 * matching component. Slug values are case-insensitive and may use
 * dashes for readability. Anything else falls back to rendering the
 * value as a literal emoji glyph. */
type LucideLikeIcon = ComponentType<SVGProps<SVGSVGElement>>

const ICON_REGISTRY: Record<string, LucideLikeIcon> = {
  user: User,
  "user-circle": CircleUser,
  profile: User,
  mushroom: MushroomIcon,
  ticket: Ticket,
  tent: Tent,
  housing: Tent,
  parking: ParkingSquare,
  film: Film,
  movie: Film,
  image: ImageIcon,
  photo: ImageIcon,
  gallery: ImageIcon,
  help: HelpCircle,
  faq: HelpCircle,
  cart: ShoppingCart,
  checkout: ShoppingCart,
  bag: ShoppingBag,
  heart: Heart,
  play: Play,
  shield: Shield,
  home: Home,
}

function resolveIconName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "-")
}

function getRegistryIcon(value: string | null | undefined): LucideLikeIcon | null {
  if (!value) return null
  const slug = resolveIconName(value)
  return ICON_REGISTRY[slug] ?? null
}

const SECTION_ICONS: Record<string, LucideLikeIcon> = {
  passes: Ticket,
  housing: Tent,
  parking: ParkingSquare,
  merch: ShoppingBag,
  patron: Heart,
  confirm: ShoppingCart,
  buyer: User,
  hero: MushroomIcon,
}

const TEMPLATE_ICONS: Record<string, LucideLikeIcon> = {
  "ticket-select": Ticket,
  "ticket-card": Ticket,
  "patron-preset": Heart,
  "housing-date": Tent,
  "merch-image": ShoppingBag,
  "youtube-video": Film,
  "image-gallery": ImageIcon,
  "rich-text": MushroomIcon,
  "buyer-form": User,
  faqs: HelpCircle,
}

function resolveIcon(section: {
  id: string
  template?: string | null
}): LucideLikeIcon {
  if (section.template && TEMPLATE_ICONS[section.template]) {
    return TEMPLATE_ICONS[section.template]
  }
  return SECTION_ICONS[section.id] ?? Ticket
}

interface NavSection {
  id: string
  label: string
  template?: string | null
  /** Tenant-picked emoji rendered in place of the Lucide icon when set. */
  emoji?: string | null
}

interface ScrollySectionNavProps {
  sections: NavSection[]
  activeSection: string
  onSectionClick: (sectionId: string) => void
  extraContent?: ReactNode
  /** Tenant logo (popup icon_url with tenant fallback) shown on the left
   * of the nav. Skipped when null. */
  brandLogoUrl?: string | null
  /** Display name used as alt text on the logo. */
  brandLabel?: string
}

export default function ScrollySectionNav({
  sections,
  activeSection,
  onSectionClick,
  extraContent,
  brandLogoUrl,
  brandLabel,
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
          {brandLogoUrl ? (
            // biome-ignore lint: tenant logo, sized small, no need for next/image SSR
            <img
              src={brandLogoUrl}
              alt={brandLabel ?? "Tenant logo"}
              className="size-7 shrink-0 rounded-md object-contain"
            />
          ) : null}
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
                // Per-step emoji takes precedence over the built-in icon when
                // the tenant set one in the backoffice. Plain text node — no
                // sanitization needed since SQLAlchemy capped the column at 8
                // chars and emoji are inert.
                const emoji = section.emoji?.trim()
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
                    {(() => {
                      // Two ways a tenant can specify the nav icon: as a
                      // slug into the curated Lucide registry (e.g. "user"
                      // or "mushroom") which renders a flat-line SVG, OR
                      // as a literal emoji character. If neither is set,
                      // fall back to the step-type/template default. The
                      // emoji branch also picks up the optional monochrome
                      // filter so colorful glyphs can be forced to one tone.
                      const RegistryIcon = getRegistryIcon(emoji)
                      if (RegistryIcon) {
                        return <RegistryIcon className="size-3.5 shrink-0" />
                      }
                      if (emoji) {
                        return (
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
                        )
                      }
                      return <Icon className="size-3.5 shrink-0" />
                    })()}
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
