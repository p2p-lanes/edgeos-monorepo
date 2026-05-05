import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic"
import type { ComponentProps } from "react"

const VALID = new Set<string>(iconNames)

const LEGACY_ALIASES: Record<string, IconName> = {
  chairs: "armchair",
  chair: "armchair",
  microphone: "mic",
  wheelchair: "accessibility",
  couch: "sofa",
  screen: "monitor",
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

function normalizeToSlug(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
}

function resolveSlug(name: string | null | undefined): IconName | null {
  if (!name) return null
  const slug = normalizeToSlug(name)
  if (!slug) return null
  if (VALID.has(slug)) return slug as IconName
  const aliased = LEGACY_ALIASES[slug]
  if (aliased && VALID.has(aliased)) return aliased
  return null
}

type LucideIconProps = {
  name: string | null | undefined
} & Omit<ComponentProps<typeof DynamicIcon>, "name">

export function LucideIcon({ name, ...rest }: LucideIconProps) {
  const slug = resolveSlug(name)
  if (!slug) return null
  return <DynamicIcon name={slug} {...rest} />
}
