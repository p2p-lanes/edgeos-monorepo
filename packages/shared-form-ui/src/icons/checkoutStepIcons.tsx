"use client"

import {
  BadgeCheck,
  BedDouble,
  Bike,
  BookOpen,
  Building2,
  CakeSlice,
  Calendar,
  Camera,
  CheckCircle,
  ChefHat,
  CircleUser,
  ClipboardList,
  Clock,
  Coffee,
  Compass,
  Contact,
  CreditCard,
  FileText,
  Film,
  Gift,
  Handshake,
  Heart,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Info,
  KeyRound,
  Lock,
  Mail,
  Map as MapIcon,
  MapPin,
  Mountain,
  Music,
  Newspaper,
  ParkingSquare,
  Phone,
  Play,
  Receipt,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  Tag,
  Tent,
  Ticket,
  User,
  Users,
  Utensils,
  Wallet,
  Waves,
  Wine,
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

/** Display order of the groups in the backoffice picker. */
export const CHECKOUT_ICON_GROUPS = [
  "Commerce",
  "People",
  "Place",
  "Food",
  "Media",
  "Activity",
  "Trust",
] as const

export type CheckoutIconGroup = (typeof CHECKOUT_ICON_GROUPS)[number]

export interface CheckoutIconEntry {
  /** Stored verbatim in `ticketingsteps.emoji`. Lowercase kebab-case. */
  slug: string
  /** Human label — the picker's tooltip, accessible name and search text. */
  label: string
  group: CheckoutIconGroup
  Icon: LucideLikeIcon
}

/**
 * The curated set an operator can choose from. This is the single source of
 * truth: `ICON_REGISTRY` below is derived from it, so the picker can never
 * offer an icon the checkout cannot resolve.
 */
export const CHECKOUT_ICON_CATALOG: CheckoutIconEntry[] = [
  // Commerce
  { slug: "ticket", label: "Ticket", group: "Commerce", Icon: Ticket },
  { slug: "cart", label: "Cart", group: "Commerce", Icon: ShoppingCart },
  { slug: "bag", label: "Shopping bag", group: "Commerce", Icon: ShoppingBag },
  {
    slug: "credit-card",
    label: "Credit card",
    group: "Commerce",
    Icon: CreditCard,
  },
  { slug: "wallet", label: "Wallet", group: "Commerce", Icon: Wallet },
  { slug: "tag", label: "Tag", group: "Commerce", Icon: Tag },
  { slug: "gift", label: "Gift", group: "Commerce", Icon: Gift },
  { slug: "receipt", label: "Receipt", group: "Commerce", Icon: Receipt },
  {
    slug: "badge-check",
    label: "Verified badge",
    group: "Commerce",
    Icon: BadgeCheck,
  },

  // People
  { slug: "user", label: "Person", group: "People", Icon: User },
  { slug: "users", label: "Group", group: "People", Icon: Users },
  { slug: "user-circle", label: "Profile", group: "People", Icon: CircleUser },
  { slug: "contact", label: "Contact card", group: "People", Icon: Contact },
  { slug: "heart", label: "Heart", group: "People", Icon: Heart },
  { slug: "handshake", label: "Handshake", group: "People", Icon: Handshake },

  // Place
  { slug: "home", label: "Home", group: "Place", Icon: Home },
  { slug: "tent", label: "Tent", group: "Place", Icon: Tent },
  { slug: "bed", label: "Bed", group: "Place", Icon: BedDouble },
  { slug: "building", label: "Building", group: "Place", Icon: Building2 },
  { slug: "map-pin", label: "Map pin", group: "Place", Icon: MapPin },
  { slug: "key", label: "Key", group: "Place", Icon: KeyRound },
  { slug: "parking", label: "Parking", group: "Place", Icon: ParkingSquare },

  // Food
  { slug: "utensils", label: "Utensils", group: "Food", Icon: Utensils },
  { slug: "chef-hat", label: "Chef hat", group: "Food", Icon: ChefHat },
  { slug: "coffee", label: "Coffee", group: "Food", Icon: Coffee },
  { slug: "wine", label: "Wine", group: "Food", Icon: Wine },
  { slug: "cake", label: "Cake", group: "Food", Icon: CakeSlice },
  { slug: "mushroom", label: "Mushroom", group: "Food", Icon: MushroomIcon },

  // Media
  { slug: "image", label: "Image", group: "Media", Icon: ImageIcon },
  { slug: "film", label: "Film", group: "Media", Icon: Film },
  { slug: "play", label: "Play", group: "Media", Icon: Play },
  { slug: "camera", label: "Camera", group: "Media", Icon: Camera },
  { slug: "music", label: "Music", group: "Media", Icon: Music },
  { slug: "book", label: "Book", group: "Media", Icon: BookOpen },
  { slug: "newspaper", label: "Newspaper", group: "Media", Icon: Newspaper },

  // Activity
  { slug: "calendar", label: "Calendar", group: "Activity", Icon: Calendar },
  { slug: "clock", label: "Clock", group: "Activity", Icon: Clock },
  { slug: "map", label: "Map", group: "Activity", Icon: MapIcon },
  { slug: "compass", label: "Compass", group: "Activity", Icon: Compass },
  { slug: "bike", label: "Bike", group: "Activity", Icon: Bike },
  { slug: "waves", label: "Waves", group: "Activity", Icon: Waves },
  { slug: "mountain", label: "Mountain", group: "Activity", Icon: Mountain },
  { slug: "sun", label: "Sun", group: "Activity", Icon: Sun },
  { slug: "sparkles", label: "Sparkles", group: "Activity", Icon: Sparkles },
  { slug: "star", label: "Star", group: "Activity", Icon: Star },

  // Trust
  { slug: "shield", label: "Shield", group: "Trust", Icon: Shield },
  { slug: "check", label: "Check", group: "Trust", Icon: CheckCircle },
  { slug: "help", label: "Help", group: "Trust", Icon: HelpCircle },
  { slug: "info", label: "Info", group: "Trust", Icon: Info },
  { slug: "lock", label: "Lock", group: "Trust", Icon: Lock },
  { slug: "mail", label: "Mail", group: "Trust", Icon: Mail },
  { slug: "phone", label: "Phone", group: "Trust", Icon: Phone },
  { slug: "file", label: "Document", group: "Trust", Icon: FileText },
  {
    slug: "checklist",
    label: "Checklist",
    group: "Trust",
    Icon: ClipboardList,
  },
  { slug: "settings", label: "Settings", group: "Trust", Icon: Settings },
]

/**
 * Synonyms and legacy slugs. These resolve but are deliberately absent from
 * the catalog so the picker shows one button per icon. Every value here must
 * name a catalog slug.
 */
export const ICON_ALIASES: Record<string, string> = {
  profile: "user",
  house: "home",
  housing: "tent",
  movie: "film",
  photo: "image",
  gallery: "image",
  faq: "help",
  checkout: "cart",
  fork: "utensils",
  meal: "utensils",
  "meal-plan": "utensils",
  chef: "chef-hat",
}

/**
 * Slug → component, derived from the catalog plus the alias table. Admins set
 * `step.emoji` to one of these slugs and the nav + cart drawer render the
 * matching component. Lookups are case-insensitive and whitespace-tolerant.
 */
const ICON_REGISTRY: Record<string, LucideLikeIcon> = (() => {
  const registry: Record<string, LucideLikeIcon> = {}
  for (const entry of CHECKOUT_ICON_CATALOG) {
    registry[entry.slug] = entry.Icon
  }
  for (const [alias, target] of Object.entries(ICON_ALIASES)) {
    const icon = registry[target]
    if (icon) registry[alias] = icon
  }
  return registry
})()

/**
 * Step-type → default icon. Used when the tenant hasn't set an emoji /
 * registry slug and the template doesn't carry one either. Keeps the
 * built-in step semantics readable in the nav.
 */
const SECTION_ICONS: Record<string, LucideLikeIcon> = {
  passes: Ticket,
  tickets: Ticket,
  housing: Home,
  merch: ShoppingBag,
  patron: Heart,
  meal_plan: Utensils,
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
  "meal-plan-select": Utensils,
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
