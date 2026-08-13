import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { type GoogleFont, GoogleFontsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  buildPreviewStylesheetUrl,
  isValidFontFamily,
  toCssFontFamily,
} from "@/lib/google-font"
import { cn } from "@/lib/utils"

const ROW_HEIGHT = 44
const LIST_WIDTH = 320
const LIST_HEIGHT = 280

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "sans-serif", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Script" },
  { value: "monospace", label: "Mono" },
] as const

/**
 * Families whose preview face has already been requested this session.
 * Module-level on purpose: the picker unmounts every time the popover closes,
 * and re-requesting the same stylesheet on each reopen would be pure waste.
 */
const requestedPreviews = new Set<string>()

interface GoogleFontPickerProps {
  value: string
  onChange: (family: string) => void
  placeholder?: string
  disabled?: boolean
  "aria-label"?: string
}

/**
 * Single-select over the Google Fonts catalog (~1950 families), served by our
 * own backend so the API key stays server-side.
 *
 * Two things drive the shape of this component:
 *  - The list is virtualized. Rendering 1950 rows makes the search input drop
 *    keystrokes.
 *  - Each row renders in its own face, which means actually loading that font.
 *    Only the rows on screen are fetched, and only at weight 400 — loading the
 *    whole catalog would be hundreds of megabytes.
 */
export function GoogleFontPicker({
  value,
  onChange,
  placeholder = "Portal default",
  disabled,
  "aria-label": ariaLabel,
}: GoogleFontPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["google-fonts"],
    queryFn: () => GoogleFontsService.listGoogleFonts(),
    // The backend already caches this for a day; within a session it never
    // changes, so never refetch it out from under an open picker.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })

  const fonts = useMemo(() => data?.fonts ?? [], [data])

  const matches = useMemo(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return fonts.filter((font: GoogleFont) => {
      if (category && font.category !== category) return false
      if (tokens.length === 0) return true
      const text = font.family.toLowerCase()
      return tokens.every((token) => text.includes(token))
    })
  }, [fonts, query, category])

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    // Viewport size to assume before the first measurement lands. Without it
    // the first paint after the popover opens has a zero-height viewport and
    // renders no rows at all — briefly in the browser, permanently under
    // jsdom, which has no layout to measure.
    initialRect: { width: LIST_WIDTH, height: LIST_HEIGHT },
  })

  const virtualRows = virtualizer.getVirtualItems()

  // Load the preview face for whatever is on screen. Debounced because
  // scrolling and typing both churn this list several times a second, and each
  // change would otherwise be a stylesheet request.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const pending = virtualRows
        .map((row) => matches[row.index]?.family)
        .filter(
          (family): family is string =>
            isValidFontFamily(family) && !requestedPreviews.has(family),
        )
      if (pending.length === 0) return

      const href = buildPreviewStylesheetUrl(pending)
      if (!href) return
      for (const family of pending) requestedPreviews.add(family)

      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = href
      document.head.appendChild(link)
      // Deliberately not removed on cleanup: the faces stay useful for the
      // rest of the session, and `requestedPreviews` assumes they persist.
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open, virtualRows, matches])

  const pick = (family: string) => {
    onChange(family)
    setOpen(false)
    setQuery("")
  }

  const selectedCss = toCssFontFamily(value)

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery("")
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "h-8 w-[190px] justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span
              className="truncate text-xs"
              style={selectedCss ? { fontFamily: selectedCss } : undefined}
            >
              {value || placeholder}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] p-0">
          <div className="border-b p-2">
            <Input
              placeholder="Search Google Fonts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {CATEGORIES.map((entry) => (
                <button
                  key={entry.value || "all"}
                  type="button"
                  onClick={() => setCategory(entry.value)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    category === entry.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {data?.source === "fallback" && (
            <p className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              Showing a short built-in list — the Google Fonts catalog is
              unavailable.
            </p>
          )}

          <div
            ref={scrollRef}
            className="overflow-y-auto"
            style={{ maxHeight: LIST_HEIGHT }}
          >
            {isLoading && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                Loading fonts…
              </p>
            )}
            {isError && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                Could not load the font list.
              </p>
            )}
            {!isLoading && !isError && matches.length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No font matches "{query}".
              </p>
            )}
            {matches.length > 0 && (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  position: "relative",
                  width: "100%",
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const font = matches[virtualRow.index]
                  if (!font) return null
                  const css = toCssFontFamily(font.family)
                  return (
                    <button
                      key={font.family}
                      type="button"
                      // Without this the accessible name is the family and
                      // the category run together ("Intersans-serif").
                      aria-label={font.family}
                      onClick={() => pick(font.family)}
                      className="absolute left-0 flex w-full items-center gap-2 px-3 text-left hover:bg-muted"
                      style={{
                        top: 0,
                        height: `${ROW_HEIGHT}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          font.family === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        {/* The family name in its own face — the whole point
                            of a font picker. Falls back to the UI font until
                            the preview stylesheet lands. */}
                        <span
                          className="truncate text-sm leading-tight"
                          style={css ? { fontFamily: css } : undefined}
                        >
                          {font.family}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {font.category}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {matches.length > 0 && (
            <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              {matches.length} font{matches.length === 1 ? "" : "s"}
            </p>
          )}
        </PopoverContent>
      </Popover>

      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          aria-label="Clear font"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
