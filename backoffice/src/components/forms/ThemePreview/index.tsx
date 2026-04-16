// ──────────────────────────────────────────────────────────────────────────
// ThemePreview — 1:1 replica of the portal scaled at 0.5x, as a live preview
// of the popup's theme configuration.
//
// Two tabs today:
//   - "home"     — /portal/[popupSlug] layout (Sidebar + HeaderBar + EventCard)
//   - "checkout" — /checkout/[popupSlug] (ScrollyCheckoutFlow)
//
// The preview uses the *same* CSS variable names the real portal components
// consume at runtime (see constants.ts). The only thing this module knows
// about the form is the shape of the colors object plus a handful of popup
// fields threaded as `previewEvent`.
//
// Why scale instead of resize: the portal is designed for ~760px content
// width with real Tailwind sizing (`text-3xl`, `h-9`, `px-6`...). Reproducing
// that at half size by changing classes would drift visually. Scaling the
// entire viewport by 0.5 keeps proportions identical to production.
// ──────────────────────────────────────────────────────────────────────────

import { Maximize2 } from "lucide-react"
import type * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  SCALE,
  TAB_LABELS,
  TAB_OF_KEY,
  TABS,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from "./constants"
import { ExpandPreviewDialog } from "./ExpandPreviewDialog"
import { PreviewProvider } from "./parts/PreviewContext"
import { CheckoutView } from "./tabs/CheckoutView"
import { HomeView } from "./tabs/HomeView"
import type { ThemePreviewProps } from "./types"
import { useCssVars } from "./useCssVars"

export type { PreviewEvent, PreviewTab } from "./types"

export function ThemePreview({
  colors,
  fontBaseSize,
  fontHeadingScale,
  radius,
  borderRadius,
  highlightedKeys,
  activeTab,
  onTabChange,
  previewEvent,
}: ThemePreviewProps) {
  const [expanded, setExpanded] = useState(false)

  // First highlighted key (the user is hovering one field at a time, so the
  // set has at most one element in practice).
  const firstHovered = useMemo(() => {
    const iter = highlightedKeys.values().next()
    return iter.done ? null : iter.value
  }, [highlightedKeys])

  // Auto-switch to the tab that visibly contains the hovered key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only depends on firstHovered — including activeTab/onTabChange would re-run on every manual tab click and fight the user
  useEffect(() => {
    if (!firstHovered) return
    const target = TAB_OF_KEY[firstHovered]
    if (target && target !== activeTab) {
      onTabChange(target)
    }
  }, [firstHovered])

  const cssVars = useCssVars(colors, radius, borderRadius)
  const headingScale = Number.parseFloat(fontHeadingScale) || 1.6

  const tabContent = activeTab === "home" ? <HomeView /> : <CheckoutView />

  return (
    <div className="rounded-lg border bg-muted/20 p-2 shadow-sm">
      {/* Tabs header + expand button */}
      <div className="mb-2 flex items-center gap-1">
        <div className="flex flex-1 gap-1 rounded-md bg-muted/40 p-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Expand preview"
          aria-label="Expand preview"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Header strip */}
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live preview
        </span>
        <span className="text-[10px] text-muted-foreground">
          {highlightedKeys.size > 0
            ? `Highlighting: ${[...highlightedKeys].join(", ")}`
            : "Hover a field"}
        </span>
      </div>

      {/* Scaled viewport. The outer box clips at VIEWPORT_*; the inner box
          draws at native portal size and is then scaled to SCALE. */}
      <div
        className="overflow-hidden rounded-md border bg-white"
        style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }}
      >
        <div
          style={{
            width: NATIVE_WIDTH,
            height: NATIVE_HEIGHT,
            transform: `scale(${SCALE})`,
            transformOrigin: "top left",
            ...(cssVars as React.CSSProperties),
            backgroundColor: "var(--background)",
            color: "var(--body)",
            // The portal uses Geist; the backoffice doesn't load it. Falling
            // back to system-ui keeps proportions reasonable without extra
            // network requests for a preview-only surface.
            fontFamily: "system-ui, sans-serif",
            fontSize: fontBaseSize || "16px",
          }}
        >
          <PreviewProvider
            event={previewEvent}
            highlightedKeys={highlightedKeys}
            headingScale={headingScale}
          >
            {tabContent}
          </PreviewProvider>
        </div>
      </div>

      <ExpandPreviewDialog
        open={expanded}
        onOpenChange={setExpanded}
        activeTab={activeTab}
        cssVars={cssVars}
        fontBaseSize={fontBaseSize}
      >
        <PreviewProvider
          event={previewEvent}
          highlightedKeys={highlightedKeys}
          headingScale={headingScale}
        >
          {tabContent}
        </PreviewProvider>
      </ExpandPreviewDialog>
    </div>
  )
}
