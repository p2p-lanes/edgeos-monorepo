import { useVirtualizer } from "@tanstack/react-virtual"
import { DynamicIcon, iconNames } from "lucide-react/dynamic"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Input } from "@/components/ui/input"

interface Props {
  seed?: string
  onPick: (slug: string) => void
}

const MIN_COL_WIDTH = 68
const ROW_HEIGHT = 56

export default function LucideIconGrid({ seed, onPick }: Props) {
  const [query, setQuery] = useState(seed ?? "")
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(9)

  useEffect(() => {
    setQuery(seed ?? "")
  }, [seed])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const recompute = () => {
      const available = el.clientWidth - 16
      setCols(Math.max(1, Math.floor(available / MIN_COL_WIDTH)))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-")
    if (!q) return iconNames
    return iconNames.filter((slug) => slug.includes(q))
  }, [query])

  const rowCount = Math.ceil(filtered.length / cols)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  })

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
      <div
        ref={scrollRef}
        className="max-h-[55vh] overflow-y-auto rounded-md border"
      >
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No icons match "{query}".
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowStart = virtualRow.index * cols
              const rowIcons = filtered.slice(rowStart, rowStart + cols)
              return (
                <div
                  key={virtualRow.key}
                  className="grid gap-1 px-2"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${ROW_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  }}
                >
                  {rowIcons.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      title={slug}
                      onClick={() => onPick(slug)}
                      className="flex aspect-square items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DynamicIcon name={slug} className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
