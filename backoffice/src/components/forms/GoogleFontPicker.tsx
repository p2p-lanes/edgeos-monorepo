import { useQuery } from "@tanstack/react-query"
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

const LIST_HEIGHT = 280
const PAGE_SIZE = 20

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
 * The full catalog remains searchable, but only a small, progressively
 * disclosed page is rendered and preview-loaded at a time.
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
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

  const visibleMatches = useMemo(
    () => matches.slice(0, visibleCount),
    [matches, visibleCount],
  )

  const resetVisibleResults = () => {
    setVisibleCount(PAGE_SIZE)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  // Load previews only for rows the operator has chosen to reveal.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const pending = visibleMatches
        .map((font) => font.family)
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
  }, [open, visibleMatches])

  const pick = (family: string) => {
    onChange(family)
    setOpen(false)
    setQuery("")
    resetVisibleResults()
  }

  const selectedCss = toCssFontFamily(value)

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setQuery("")
            resetVisibleResults()
          }
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
              onChange={(e) => {
                setQuery(e.target.value)
                resetVisibleResults()
              }}
              className="h-8 text-xs"
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {CATEGORIES.map((entry) => (
                <button
                  key={entry.value || "all"}
                  type="button"
                  onClick={() => {
                    setCategory(entry.value)
                    resetVisibleResults()
                  }}
                  aria-pressed={category === entry.value}
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
              <>
                <div role="listbox" aria-label="Google Fonts">
                  {visibleMatches.map((font) => {
                    const css = toCssFontFamily(font.family)
                    return (
                      <button
                        key={font.family}
                        type="button"
                        role="option"
                        aria-selected={font.family === value}
                        // Without this the accessible name is the family and
                        // the category run together ("Intersans-serif").
                        aria-label={font.family}
                        onClick={() => pick(font.family)}
                        className="flex h-11 w-full items-center gap-2 px-3 text-left hover:bg-muted"
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
                {visibleCount < matches.length && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 w-full rounded-none border-t text-xs"
                    onClick={() =>
                      setVisibleCount((current) =>
                        Math.min(current + PAGE_SIZE, matches.length),
                      )
                    }
                  >
                    Show more
                  </Button>
                )}
              </>
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
