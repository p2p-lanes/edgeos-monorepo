import * as Lucide from "lucide-react"
import { iconNames } from "lucide-react/dynamic"
import type { ComponentType } from "react"
import { useEffect, useMemo, useState } from "react"

import { Input } from "@/components/ui/input"

type IconComponent = ComponentType<{ className?: string }>

function slugToPascal(slug: string): string {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("")
}

type ResolvedIcon = { slug: string; Component: IconComponent }

const RESOLVED: ResolvedIcon[] = iconNames.flatMap((slug): ResolvedIcon[] => {
  const Component = (Lucide as unknown as Record<string, IconComponent>)[
    slugToPascal(slug)
  ]
  return Component ? [{ slug, Component }] : []
})

interface Props {
  seed?: string
  onPick: (slug: string) => void
}

export default function LucideIconGrid({ seed, onPick }: Props) {
  const [query, setQuery] = useState(seed ?? "")

  useEffect(() => {
    setQuery(seed ?? "")
  }, [seed])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-")
    if (!q) return RESOLVED
    return RESOLVED.filter((entry) => entry.slug.includes(q))
  }, [query])

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search icons (e.g. mic, chair, ambulance)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <p className="text-xs text-muted-foreground">
        {filtered.length} icon{filtered.length === 1 ? "" : "s"}
      </p>
      <div className="max-h-[55vh] overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No icons match "{query}".
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1 p-2">
            {filtered.map(({ slug, Component }) => (
              <button
                key={slug}
                type="button"
                title={slug}
                onClick={() => onPick(slug)}
                className="flex aspect-square items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Component className="h-5 w-5" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
