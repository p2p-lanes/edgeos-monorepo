// ──────────────────────────────────────────────────────────────────────────
// ThemePreview — 1:1 replica of the portal scaled at 0.5x.
//
// Lives in its own file because it's mostly a long block of JSX that mirrors
// the real portal components (HeaderBar, ScrollyCheckoutFlow, EventCard,
// SidebarComponents) using the *same* CSS variables those components consume
// at runtime. The only thing this file knows about the form is the shape of
// the colors object — everything else is portal markup with portal vars.
//
// Why scale instead of resize:
//   The portal is designed for ~760px content width with real Tailwind sizing
//   (`text-3xl`, `h-9`, `px-6`...). Reproducing that at half size by changing
//   classes would drift visually. Scaling the entire viewport by 0.5 keeps
//   proportions identical to production.
// ──────────────────────────────────────────────────────────────────────────

import type * as React from "react"
import { useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"

export type PreviewTab = "landing" | "passes" | "checkout" | "sidebar"

interface ThemePreviewProps {
  colors: Record<string, string>
  fontBaseSize: string
  fontHeadingScale: string
  radius: string
  highlightedKeys: Set<string>
  activeTab: PreviewTab
  onTabChange: (tab: PreviewTab) => void
}

// Mapping color_key -> CSS variable. MUST stay in sync with
// portal/src/providers/themeProvider.tsx (COLOR_KEY_TO_CSS_VAR).
const CSS_VAR_MAP: Record<string, string> = {
  background: "--background",
  foreground: "--foreground",
  heading: "--heading",
  heading_secondary: "--heading-secondary",
  body: "--body",
  nav_text: "--nav-text",
  nav_text_secondary: "--nav-text-secondary",
  pass_title: "--pass-title",
  pass_text: "--pass-text",
  checkout_nav_bg: "--checkout-nav-bg",
  checkout_nav_text: "--checkout-nav-text",
  primary: "--primary",
  primary_foreground: "--primary-foreground",
  secondary: "--secondary",
  secondary_foreground: "--secondary-foreground",
  card: "--card",
  card_foreground: "--card-foreground",
  popover: "--popover",
  popover_foreground: "--popover-foreground",
  muted: "--muted",
  muted_foreground: "--muted-foreground",
  accent: "--accent",
  accent_foreground: "--accent-foreground",
  destructive: "--destructive",
  destructive_foreground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebar_foreground: "--sidebar-foreground",
  sidebar_primary: "--sidebar-primary",
  sidebar_primary_foreground: "--sidebar-primary-foreground",
  sidebar_accent: "--sidebar-accent",
  sidebar_accent_foreground: "--sidebar-accent-foreground",
  sidebar_border: "--sidebar-border",
  sidebar_ring: "--sidebar-ring",
}

// Defaults copied 1:1 from portal/src/app/globals.css :root (lines 95-138).
// Used as the base layer for the preview's CSS vars; user overrides win.
const PORTAL_DEFAULT_VARS: Record<string, string> = {
  "--radius": "0.5rem",
  "--background": "oklch(1 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--heading": "oklch(0.145 0 0)",
  "--heading-secondary": "oklch(0.556 0.01 260)",
  "--body": "oklch(0.145 0 0)",
  "--nav-text": "oklch(0.145 0 0)",
  "--nav-text-secondary": "oklch(0.556 0.01 260)",
  "--pass-title": "oklch(0.145 0 0)",
  "--pass-text": "oklch(0.556 0.01 260)",
  "--checkout-nav-bg": "oklch(1 0 0)",
  "--checkout-nav-text": "oklch(0.145 0 0)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.205 0.015 285)",
  "--popover": "oklch(1 0 0)",
  "--popover-foreground": "oklch(0.205 0.015 285)",
  "--primary": "oklch(0.279 0.041 260)",
  "--primary-foreground": "oklch(0.975 0.005 285)",
  "--secondary": "oklch(0.965 0.005 285)",
  "--secondary-foreground": "oklch(0.279 0.041 260)",
  "--muted": "oklch(0.965 0.005 285)",
  "--muted-foreground": "oklch(0.556 0.01 260)",
  "--accent": "oklch(0.965 0.005 285)",
  "--accent-foreground": "oklch(0.279 0.041 260)",
  "--destructive": "oklch(0.577 0.245 27.325)",
  "--destructive-foreground": "oklch(0.975 0.005 285)",
  "--border": "oklch(0.922 0.005 285)",
  "--input": "oklch(0.922 0.005 285)",
  "--ring": "oklch(0.205 0.015 285)",
  "--sidebar": "oklch(0.985 0 0)",
  "--sidebar-foreground": "oklch(0.37 0.01 260)",
  "--sidebar-primary": "oklch(0.205 0.015 260)",
  "--sidebar-primary-foreground": "oklch(0.985 0 0)",
  "--sidebar-accent": "oklch(0.965 0.005 260)",
  "--sidebar-accent-foreground": "oklch(0.205 0.015 260)",
  "--sidebar-border": "oklch(0.922 0.01 260)",
  "--sidebar-ring": "oklch(0.548 0.22 260)",
}

// Maps a color key to the tab where it is most visibly applied. Hovering a
// field in the form auto-switches the preview to the matching tab so the user
// always sees the impact of what they're editing.
const TAB_OF_KEY: Record<string, PreviewTab> = {
  background: "landing",
  foreground: "landing",
  heading: "landing",
  heading_secondary: "landing",
  body: "landing",
  nav_text: "landing",
  nav_text_secondary: "landing",
  primary: "landing",
  primary_foreground: "landing",
  secondary: "landing",
  secondary_foreground: "landing",
  accent: "landing",
  accent_foreground: "landing",
  ring: "landing",
  card: "passes",
  card_foreground: "passes",
  pass_title: "passes",
  pass_text: "passes",
  popover: "passes",
  popover_foreground: "passes",
  muted: "passes",
  muted_foreground: "passes",
  destructive: "passes",
  destructive_foreground: "passes",
  border: "passes",
  input: "passes",
  checkout_nav_bg: "checkout",
  checkout_nav_text: "checkout",
  sidebar: "sidebar",
  sidebar_foreground: "sidebar",
  sidebar_primary: "sidebar",
  sidebar_primary_foreground: "sidebar",
  sidebar_accent: "sidebar",
  sidebar_accent_foreground: "sidebar",
  sidebar_border: "sidebar",
  sidebar_ring: "sidebar",
}

const TAB_LABELS: Record<PreviewTab, string> = {
  landing: "Landing",
  passes: "Pases",
  checkout: "Checkout",
  sidebar: "Sidebar",
}

// Native (pre-scale) viewport. The portal is designed around ~760px content
// columns; we draw at that width and scale down to fit the right column of
// the form. The visible (post-scale) box is 380x520.
const NATIVE_WIDTH = 760
const NATIVE_HEIGHT = 1040
const SCALE = 0.5
const VIEWPORT_WIDTH = NATIVE_WIDTH * SCALE
const VIEWPORT_HEIGHT = NATIVE_HEIGHT * SCALE

export function ThemePreview({
  colors,
  fontBaseSize,
  fontHeadingScale,
  radius,
  highlightedKeys,
  activeTab,
  onTabChange,
}: ThemePreviewProps) {
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

  // Build the CSS-variable style object: portal defaults overridden by user.
  const cssVars = useMemo(() => {
    const styles: Record<string, string> = { ...PORTAL_DEFAULT_VARS }
    for (const [key, value] of Object.entries(colors)) {
      const cssVar = CSS_VAR_MAP[key]
      if (cssVar && value) styles[cssVar] = value
    }
    if (radius) styles["--radius"] = radius
    return styles
  }, [colors, radius])

  const headingScale = Number.parseFloat(fontHeadingScale) || 1.6

  return (
    <div className="rounded-lg border bg-muted/20 p-2 shadow-sm">
      {/* Tabs header */}
      <div className="mb-2 flex gap-1 rounded-md bg-muted/40 p-1">
        {(["landing", "passes", "checkout", "sidebar"] as const).map((tab) => (
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

      {/* Header strip */}
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live preview
        </span>
        <span className="text-[10px] text-muted-foreground">
          {highlightedKeys.size > 0
            ? `Resaltando: ${[...highlightedKeys].join(", ")}`
            : "Hover sobre un campo"}
        </span>
      </div>

      {/* Scaled viewport. The outer box clips at 380x520; the inner box draws
          at native portal size (760xN) and is then scaled to 0.5. */}
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
          {activeTab === "landing" && (
            <LandingView
              highlightedKeys={highlightedKeys}
              headingScale={headingScale}
            />
          )}
          {activeTab === "passes" && (
            <PassesView highlightedKeys={highlightedKeys} />
          )}
          {activeTab === "checkout" && (
            <CheckoutView highlightedKeys={highlightedKeys} />
          )}
          {activeTab === "sidebar" && (
            <SidebarView highlightedKeys={highlightedKeys} />
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Per-tab views. Each one is a literal-ish copy of the corresponding portal
// component, using inline `style` with `var(--token)` instead of the portal's
// custom Tailwind theme classes (which the backoffice doesn't define).
// ──────────────────────────────────────────────────────────────────────────

interface ViewProps {
  highlightedKeys: Set<string>
}

function ringIf(active: boolean): string {
  return active
    ? "outline outline-2 outline-blue-500 outline-offset-2 rounded-sm"
    : ""
}

function makeIsHl(highlightedKeys: Set<string>) {
  return (...keys: string[]) => keys.some((k) => highlightedKeys.has(k))
}

// Replica of portal/src/components/Sidebar/HeaderBar.tsx +
// portal/src/components/checkout-flow/ScrollyCheckoutFlow.tsx (SectionHeader)
// + button variants from portal/src/components/ui/button.tsx.
function LandingView({
  highlightedKeys,
  headingScale,
}: ViewProps & { headingScale: number }) {
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div>
      {/* Header (HeaderBar.tsx:16-62) */}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-4 border-b px-6",
          ringIf(isHl("nav_text", "nav_text_secondary", "background")),
        )}
        style={{
          backgroundColor: "var(--background)",
          color: "var(--nav-text)",
          borderColor: "var(--border)",
        }}
      >
        <div
          className="size-5 rounded"
          style={{ backgroundColor: "var(--primary)" }}
        />
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--nav-text)" }}
        >
          Inicio
        </span>
        <span className="text-sm" style={{ color: "var(--nav-text)" }}>
          Pases
        </span>
        <span
          className="text-sm"
          style={{ color: "var(--nav-text-secondary)" }}
        >
          Información
        </span>
        <div
          className="ml-auto rounded-full px-2 py-1 text-xs"
          style={{
            backgroundColor: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          ES
        </div>
      </header>

      {/* Hero (ScrollyCheckoutFlow.tsx SectionHeader, lines 58-110) */}
      <div className="mx-auto flex max-w-2xl flex-col px-4 py-12">
        <div className="mb-8">
          <div className="relative min-h-[3rem]">
            {/* Watermark */}
            <p
              className="pointer-events-none absolute -top-8 left-0 select-none text-[7rem] font-black leading-none"
              style={{ color: "var(--muted)" }}
            >
              EVENTO
            </p>
            {/* Title */}
            <h2
              className={cn(
                "relative z-10 font-bold tracking-tight",
                ringIf(isHl("heading")),
              )}
              style={{
                color: "var(--heading)",
                fontSize: `${headingScale * 2.25}rem`,
                lineHeight: 1.1,
              }}
            >
              Título del evento
            </h2>
          </div>
        </div>
        <p
          className={cn(
            "my-2 w-fit rounded px-1 text-lg",
            ringIf(isHl("heading_secondary")),
          )}
          style={{ color: "var(--heading-secondary)" }}
        >
          Subtítulo descriptivo del evento
        </p>
        <p
          className={cn(
            "mt-4 max-w-prose text-base",
            ringIf(isHl("body", "foreground")),
          )}
          style={{ color: "var(--body)" }}
        >
          Texto del cuerpo de la página principal del evento. Lorem ipsum dolor
          sit amet, consectetur adipiscing elit.
        </p>

        {/* Buttons row — default + secondary variants from button.tsx */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow",
              ringIf(isHl("primary", "primary_foreground")),
            )}
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            Comprar entrada
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow-sm",
              ringIf(isHl("secondary", "secondary_foreground")),
            )}
            style={{
              backgroundColor: "var(--secondary)",
              color: "var(--secondary-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            Más info
          </button>
        </div>

        {/* Focus ring sample (input + ring) */}
        <div className="mt-8">
          <div
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 py-2 text-sm",
              ringIf(isHl("ring", "input")),
            )}
            style={{
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              border: "1px solid var(--input)",
              boxShadow: "0 0 0 2px var(--ring)",
              borderRadius: "var(--radius)",
            }}
          >
            Input con foco
          </div>
        </div>

        {/* Accent chip — separates accent from secondary */}
        <div className="mt-4">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
              ringIf(isHl("accent", "accent_foreground")),
            )}
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            Badge de acento
          </span>
        </div>
      </div>
    </div>
  )
}

// Replica of portal/src/app/portal/[popupSlug]/passes (page heading + cards)
// using Card / CardHeader / CardContent shapes from portal/src/components/ui/card.tsx
// and EventCard.tsx layout.
function PassesView({ highlightedKeys }: ViewProps) {
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className="mx-auto max-w-3xl px-6 py-8"
      style={{ backgroundColor: "var(--background)" }}
    >
      {/* Page heading (YourPasses.tsx:65-75) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div
            className={cn("size-6 rounded", ringIf(isHl("pass_text")))}
            style={{ backgroundColor: "var(--pass-text)" }}
          />
          <h1
            className={cn(
              "text-3xl font-bold tracking-tight",
              ringIf(isHl("pass_title")),
            )}
            style={{ color: "var(--pass-title)" }}
          >
            Tus pases
          </h1>
        </div>
        <p
          className={cn("text-base", ringIf(isHl("pass_text")))}
          style={{ color: "var(--pass-text)" }}
        >
          Accedé y gestioná tus pases acá.
        </p>

        {/* Action links */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            tabIndex={-1}
            className="flex items-center gap-1.5"
            style={{ color: "var(--pass-text)" }}
          >
            + Agregar acompañante
          </button>
          <span style={{ color: "var(--border)" }}>|</span>
          <button
            type="button"
            tabIndex={-1}
            className="flex items-center gap-1.5"
            style={{ color: "var(--pass-text)" }}
          >
            Ver facturas
          </button>
        </div>
      </div>

      {/* Pass cards (Card primitives from card.tsx + EventCard.tsx) */}
      <div className="mt-8 grid grid-cols-2 gap-4">
        {[
          {
            title: "VIP",
            desc: "Acceso completo a todos los días",
            price: "$1500",
          },
          {
            title: "General",
            desc: "Entrada estándar de un día",
            price: "$500",
          },
        ].map((p) => (
          <div
            key={p.title}
            className={cn(
              "rounded-xl border shadow",
              ringIf(isHl("card", "card_foreground", "border")),
            )}
            style={{
              backgroundColor: "var(--card)",
              color: "var(--card-foreground)",
              borderColor: "var(--border)",
              borderRadius: "calc(var(--radius) + 4px)",
            }}
          >
            <div className="flex flex-col space-y-1.5 p-6">
              <h3
                className="text-lg font-semibold leading-none tracking-tight"
                style={{ color: "var(--pass-title)" }}
              >
                {p.title}
              </h3>
              <p className="text-sm" style={{ color: "var(--pass-text)" }}>
                {p.desc}
              </p>
            </div>
            <div className="p-6 pt-0">
              <div
                className="text-2xl font-bold"
                style={{ color: "var(--pass-title)" }}
              >
                {p.price}
              </div>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  "mt-3 h-9 w-full rounded-md px-4 py-2 text-sm font-medium shadow",
                  ringIf(isHl("primary")),
                )}
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-foreground)",
                  borderRadius: "var(--radius)",
                }}
              >
                Comprar
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Muted + destructive + popover row */}
      <div className="mt-6 flex gap-2">
        <div
          className={cn(
            "rounded-md px-3 py-2 text-xs",
            ringIf(isHl("muted", "muted_foreground")),
          )}
          style={{
            backgroundColor: "var(--muted)",
            color: "var(--muted-foreground)",
            borderRadius: "var(--radius)",
          }}
        >
          Texto muted
        </div>
        <div
          className={cn(
            "rounded-md px-3 py-2 text-xs",
            ringIf(isHl("destructive", "destructive_foreground")),
          )}
          style={{
            backgroundColor: "var(--destructive)",
            color: "var(--destructive-foreground)",
            borderRadius: "var(--radius)",
          }}
        >
          Error
        </div>
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            ringIf(isHl("popover", "popover_foreground")),
          )}
          style={{
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
            borderColor: "var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          Popover
        </div>
        <div
          className={cn("rounded-md px-3 py-2 text-xs", ringIf(isHl("input")))}
          style={{
            border: "1px solid var(--input)",
            color: "var(--foreground)",
            backgroundColor: "var(--background)",
            borderRadius: "var(--radius)",
          }}
        >
          Input
        </div>
      </div>
    </div>
  )
}

// Replica of portal/src/components/checkout-flow/ScrollySectionNav.tsx
// (variant pills) + a sample step body.
function CheckoutView({ highlightedKeys }: ViewProps) {
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div style={{ backgroundColor: "var(--background)" }}>
      {/* Sticky checkout nav strip (ScrollySectionNav pills) */}
      <div
        className={cn(
          "sticky top-0 z-20 border-b backdrop-blur-sm",
          ringIf(isHl("checkout_nav_bg", "checkout_nav_text")),
        )}
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--checkout-nav-bg) 95%, transparent)",
          borderColor: "var(--border)",
        }}
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4 py-2">
          <button
            type="button"
            tabIndex={-1}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm ring-1 ring-gray-200/80"
            style={{
              backgroundColor: "var(--background)",
              color: "var(--checkout-nav-text)",
            }}
          >
            Datos
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              color:
                "color-mix(in oklab, var(--checkout-nav-text) 50%, transparent)",
            }}
          >
            Pago
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              color:
                "color-mix(in oklab, var(--checkout-nav-text) 50%, transparent)",
            }}
          >
            Confirmación
          </button>
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h2
          className="mb-4 text-2xl font-bold"
          style={{ color: "var(--heading)" }}
        >
          Datos del comprador
        </h2>
        <div className="space-y-3">
          <input
            type="text"
            tabIndex={-1}
            placeholder="Nombre completo"
            readOnly
            className={cn(
              "h-9 w-full rounded-md border px-3 text-sm",
              ringIf(isHl("input")),
            )}
            style={{
              backgroundColor: "var(--background)",
              borderColor: "var(--input)",
              color: "var(--foreground)",
              borderRadius: "var(--radius)",
            }}
          />
          <input
            type="text"
            tabIndex={-1}
            placeholder="Email"
            readOnly
            className={cn(
              "h-9 w-full rounded-md border px-3 text-sm",
              ringIf(isHl("input")),
            )}
            style={{
              backgroundColor: "var(--background)",
              borderColor: "var(--input)",
              color: "var(--foreground)",
              borderRadius: "var(--radius)",
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              "h-9 w-full rounded-md px-4 py-2 text-sm font-medium shadow",
              ringIf(isHl("primary", "primary_foreground")),
            )}
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            Continuar al pago
          </button>
        </div>
      </div>
    </div>
  )
}

// Replica of portal/src/components/Sidebar/SidebarComponents.tsx (lines
// 131-149) — sidebar nav + content area.
function SidebarView({ highlightedKeys }: ViewProps) {
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div className="flex" style={{ backgroundColor: "var(--background)" }}>
      <nav
        className={cn(
          "flex h-full flex-col",
          ringIf(isHl("sidebar", "sidebar_foreground")),
        )}
        style={{
          width: 220,
          minHeight: NATIVE_HEIGHT,
          backgroundColor: "var(--sidebar)",
          color: "var(--sidebar-foreground)",
          borderRight: "1px solid var(--sidebar-border)",
        }}
      >
        <div className="p-4">
          <div
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            Navegación
          </div>
          {/* Active item */}
          <div
            className={cn(
              "mb-1 rounded-md px-3 py-2 text-sm font-medium",
              ringIf(isHl("sidebar_primary", "sidebar_primary_foreground")),
            )}
            style={{
              backgroundColor: "var(--sidebar-primary)",
              color: "var(--sidebar-primary-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            ● Dashboard
          </div>
          {/* Hover/accent item */}
          <div
            className={cn(
              "mb-1 rounded-md px-3 py-2 text-sm",
              ringIf(isHl("sidebar_accent", "sidebar_accent_foreground")),
            )}
            style={{
              backgroundColor: "var(--sidebar-accent)",
              color: "var(--sidebar-accent-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            Eventos
          </div>
          {/* Default items */}
          <div
            className="mb-1 rounded-md px-3 py-2 text-sm"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            Pases
          </div>
          <div
            className="mb-1 rounded-md px-3 py-2 text-sm"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            Configuración
          </div>
          {/* Sidebar border separator */}
          <div
            className={cn("my-3 h-px", ringIf(isHl("sidebar_border")))}
            style={{ backgroundColor: "var(--sidebar-border)" }}
          />
          {/* Focus ring sample */}
          <div
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              ringIf(isHl("sidebar_ring")),
            )}
            style={{
              boxShadow: "0 0 0 2px var(--sidebar-ring)",
              color: "var(--sidebar-foreground)",
              borderRadius: "var(--radius)",
            }}
          >
            Item con foco
          </div>
        </div>
      </nav>

      {/* Content area */}
      <div
        className="flex-1 p-6"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          (área de contenido del admin)
        </div>
      </div>
    </div>
  )
}
