"use client"

import dynamicIconImports from "lucide-react/dynamicIconImports"
import type { ComponentType } from "react"
import { lazy, Suspense, useMemo } from "react"

const AVAILABLE = new Set(Object.keys(dynamicIconImports))

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

function resolveSlug(name: string | null | undefined): string | null {
  if (!name) return null
  const slug = normalizeToSlug(name)
  if (!slug) return null
  if (AVAILABLE.has(slug)) return slug
  const aliased = LEGACY_ALIASES[slug]
  if (aliased && AVAILABLE.has(aliased)) return aliased
  return null
}

interface Props {
  name: string | null | undefined
  className?: string
  size?: number
}

/**
 * Render any Lucide icon by its kebab-case slug, lazy-loaded so we only
 * fetch chunks for icons actually used at runtime.
 */
export function LucideIcon({ name, className, size }: Props) {
  const slug = useMemo(() => resolveSlug(name), [name])
  const Component = useMemo<ComponentType<{
    className?: string
    size?: number
  }> | null>(() => {
    if (!slug) return null
    const loader = dynamicIconImports[slug as keyof typeof dynamicIconImports]
    if (!loader) return null
    return lazy(async () => {
      const mod = await loader()
      return { default: mod.default as ComponentType }
    })
  }, [slug])

  if (!Component) return null
  return (
    <Suspense fallback={null}>
      <Component className={className} size={size} />
    </Suspense>
  )
}
