import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic"

const AVAILABLE = new Set<string>(iconNames)

function normalizeToSlug(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
}

const LEGACY_ALIASES: Record<string, string> = {
  chairs: "armchair",
  chair: "armchair",
  microphone: "mic",
  couch: "sofa",
  outlet: "plug",
  light: "lightbulb",
  power: "zap",
  pool: "waves",
  food: "utensils",
  water: "droplet",
  ac: "snowflake",
  box: "package",
  lock: "shield",
  internet: "wifi",
  "wi-fi": "wifi",
  gamepad: "gamepad-2",
}

function resolveSlug(name: string | null | undefined): IconName | null {
  if (!name) return null
  const slug = normalizeToSlug(name)
  if (!slug) return null
  if (AVAILABLE.has(slug)) return slug as IconName
  const aliased = LEGACY_ALIASES[slug]
  if (aliased && AVAILABLE.has(aliased)) return aliased as IconName
  return null
}

interface Props {
  name: string | null | undefined
  className?: string
  size?: number
}

/**
 * Render any Lucide icon by its kebab-case slug, lazy-loaded via the
 * dynamic registry so we only fetch chunks for icons used at runtime.
 * Returns null when the name doesn't resolve to a known icon.
 */
export function LucideIcon({ name, className, size }: Props) {
  const slug = resolveSlug(name)
  if (!slug) return null
  return <DynamicIcon name={slug} className={className} size={size} />
}
