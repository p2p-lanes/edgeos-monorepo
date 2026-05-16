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

/**
 * Custom mushroom glyph. Lucide doesn't ship one, so we inline a stroke-
 * style SVG that matches Lucide's 24x24 / stroke-2 baseline. Three spots
 * are filled in `currentColor` while the cap + stem stay stroke-only so
 * `text-*` Tailwind utilities recolour the whole glyph uniformly.
 *
 * Geometry:
 *  - Cap: half-circle of radius 9 sitting on the y=12 baseline (peak at
 *    y=3), closed flat across the bottom so it reads as a mushroom rather
 *    than a dome.
 *  - Stem: a U-shape from (10,12) down to y=18 and back to (14,12).
 *  - Spots: three asymmetric dots on the cap for visual texture.
 */
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
      <path d="M3 12a9 9 0 0 1 18 0H3Z" />
      <path d="M10 12v6a2 2 0 0 0 4 0v-6" />
      <circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Curated icon registry. Admins set `step.emoji` to one of these slug
 * names (`"user"`, `"tent"`, `"mushroom"`, …) and the nav + cart drawer
 * render the matching component. Slug values are case-insensitive and
 * may use dashes for readability.
 */
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

/**
 * Step-type → default icon. Used when the tenant hasn't set an emoji /
 * registry slug and the template doesn't carry one either. Keeps the
 * built-in step semantics readable in the nav.
 */
const SECTION_ICONS: Record<string, LucideLikeIcon> = {
  passes: Ticket,
  housing: Home,
  merch: ShoppingBag,
  patron: Heart,
  confirm: Shield,
  buyer: User,
}

/**
 * Template → default icon. Takes precedence over the step-type fallback
 * because a step's chosen template usually signals its content more
 * specifically than the step_type alone (e.g. a "tickets" step with the
 * housing-date template should still get a Home icon).
 */
const TEMPLATE_ICONS: Record<string, LucideLikeIcon> = {
  "ticket-select": Ticket,
  "patron-preset": Heart,
  "housing-date": Home,
  "merch-image": ShoppingBag,
  "youtube-video": Play,
  "image-gallery": ImageIcon,
  faqs: HelpCircle,
  "buyer-form": User,
}

/** Normalise a registry slug — lowercase, hyphen-tolerant, trimmed. */
function normaliseSlug(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Look up an icon by registry slug. Returns `null` when the input isn't a
 * known slug — callers use that to decide whether to render the literal
 * value (emoji) or fall back to the step-type default.
 */
export function getRegistryIcon(
  value: string | null | undefined,
): LucideLikeIcon | null {
  const slug = normaliseSlug(value)
  if (!slug) return null
  return ICON_REGISTRY[slug] ?? null
}

interface ResolveIconInput {
  stepType?: string | null
  template?: string | null
  /** Tenant-picked emoji or registry slug. Registry slugs win; literal
   *  emoji characters fall through to the template/step defaults so a
   *  separate render path can paint them inline. */
  emoji?: string | null
}

/**
 * Resolve which Lucide icon a step should render in the nav / cart
 * drawer. Resolution order:
 *
 *   1. `emoji` as a registry slug (e.g. `"user"` → User icon)
 *   2. `template` → TEMPLATE_ICONS
 *   3. `stepType` → SECTION_ICONS
 *   4. Ticket (last-resort default)
 */
export function resolveStepIcon({
  stepType,
  template,
  emoji,
}: ResolveIconInput): LucideLikeIcon {
  const fromRegistry = getRegistryIcon(emoji)
  if (fromRegistry) return fromRegistry
  if (template && TEMPLATE_ICONS[template]) return TEMPLATE_ICONS[template]
  if (stepType && SECTION_ICONS[stepType]) return SECTION_ICONS[stepType]
  return Ticket
}
