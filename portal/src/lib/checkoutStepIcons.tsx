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
 * Curated icon registry. Admins set `step.emoji` to one of these slug
 * names (`"user"`, `"tent"`, `"parking"`, …) and the nav + cart drawer
 * render the matching component. Slug values are case-insensitive and
 * may use dashes for readability.
 */
const ICON_REGISTRY: Record<string, LucideLikeIcon> = {
  user: User,
  "user-circle": CircleUser,
  profile: User,
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
