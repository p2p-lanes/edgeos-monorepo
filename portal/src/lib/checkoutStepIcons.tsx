"use client"

import {
  CheckCircle,
  CircleUser,
  Film,
  Heart,
  HelpCircle,
  Home,
  Image as ImageIcon,
  ParkingSquare,
  Play,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Tent,
  Ticket,
  User,
} from "lucide-react"
import type { ComponentType, SVGProps } from "react"

export type LucideLikeIcon = ComponentType<SVGProps<SVGSVGElement>>

// Custom mushroom icon — Lucide doesn't ship one, so we trace a tiny
// inline SVG that follows the same stroke style.
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
      <path d="M3 12a9 4 0 0 1 18 0v0a0 0 0 0 1 0 0H3a0 0 0 0 1 0 0Z" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      <path d="M10 12v6a2 2 0 0 0 4 0v-6" />
      <circle cx="9" cy="9" r="0.6" fill="currentColor" />
      <circle cx="14" cy="7.5" r="0.6" fill="currentColor" />
      <circle cx="17" cy="10" r="0.6" fill="currentColor" />
    </svg>
  )
}

export { MushroomIcon }

/** Curated icon registry. Tenants set `step.emoji` to one of these slug
 * names (`"user"`, `"mushroom"`, `"tent"`, …) and the nav renders the
 * matching component. Slug values are case-insensitive and may use
 * dashes for readability. */
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
  check: CheckCircle,
}

function resolveIconName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "-")
}

/** Returns the registry icon for a given emoji slug, or null if the
 * slug isn't curated (caller can then fall back to a literal emoji
 * glyph or the template/step_type defaults). */
export function getRegistryIcon(
  value: string | null | undefined,
): LucideLikeIcon | null {
  if (!value) return null
  const slug = resolveIconName(value)
  return ICON_REGISTRY[slug] ?? null
}

/** Default icon per canonical step id. */
const SECTION_ICONS: Record<string, LucideLikeIcon> = {
  passes: Ticket,
  tickets: Ticket,
  housing: Tent,
  parking: ParkingSquare,
  merch: ShoppingBag,
  patron: Heart,
  confirm: ShoppingCart,
  buyer: User,
  hero: MushroomIcon,
}

/** Default icon per step template. Checked before the step-id fallback
 * so a tenant who renames `step_type` from "housing" to something else
 * still gets the tent icon if the template stays as `housing-date`. */
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

/** Full icon resolution cascade for a checkout step:
 *   1. Tenant-configured `emoji` slug (matches the curated registry).
 *   2. Step `template` default (e.g. housing-date → Tent).
 *   3. Canonical step id default (e.g. parking → ParkingSquare).
 *   4. Generic Ticket fallback so nothing renders blank. */
export function resolveStepIcon(input: {
  stepType?: string | null
  template?: string | null
  emoji?: string | null
}): LucideLikeIcon {
  const fromEmoji = getRegistryIcon(input.emoji)
  if (fromEmoji) return fromEmoji
  if (input.template && TEMPLATE_ICONS[input.template]) {
    return TEMPLATE_ICONS[input.template]
  }
  if (input.stepType && SECTION_ICONS[input.stepType]) {
    return SECTION_ICONS[input.stepType]
  }
  return Ticket
}
