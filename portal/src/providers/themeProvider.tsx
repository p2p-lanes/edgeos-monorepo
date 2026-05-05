"use client"

import { type ReactNode, useEffect, useMemo } from "react"
import { useCityProvider } from "./cityProvider"

// ─────────────────────────────────────────────────────────────────────────────
// Design-token theme system.
//
// Admins pick 4 brand decisions and the portal derives every surface from
// those. No more hand-tuning 20+ hex values.
//
//   mode      — "light" | "dark". Chooses the neutral palette.
//   primary   — brand color (CTAs, active states, highlights, sidebar-active).
//   secondary — optional supporting color (badges, secondary buttons). Falls
//               back to the neutral muted token.
//   accent    — optional tint for hovers. Falls back to primary-mixed neutrals.
//
// Everything else is a color-mix / neutral derivation. Destructive, charts
// and focus-ring live in globals.css as fixed tokens (brand-agnostic).
// ─────────────────────────────────────────────────────────────────────────────

type ThemeMode = "light" | "dark"

interface ThemeTypography {
  font_base_size?: string
  font_heading_scale?: number
}

interface ThemeColors {
  mode?: ThemeMode
  primary_color?: string
  primary_foreground_color?: string
  secondary_color?: string
  accent_color?: string
  checkout_navbar_bg?: string
  checkout_subtitle_color?: string
}

interface ThemeConfig {
  colors?: ThemeColors & Record<string, string | undefined>
  typography?: ThemeTypography
  radius?: string
  border_radius?: string
}

// Base neutrals per mode. These are the canvas the primary is painted on.
// Kept modest — admins who need heavy brand bg tints will use the primary
// and accent instead of tweaking neutrals.
const LIGHT = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0 0)",
  foregroundSecondary: "oklch(0.556 0.01 260)",
  card: "oklch(1 0 0)",
  popover: "oklch(1 0 0)",
  muted: "oklch(0.965 0.005 285)",
  mutedForeground: "oklch(0.556 0.01 260)",
  border: "oklch(0.922 0.005 285)",
  sidebar: "oklch(0.985 0 0)",
  sidebarForeground: "oklch(0.37 0.01 260)",
  sidebarBorder: "oklch(0.922 0.01 260)",
}

const DARK = {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.985 0 0)",
  foregroundSecondary: "oklch(0.7 0.02 260)",
  card: "oklch(0.205 0.015 285)",
  popover: "oklch(0.205 0.015 285)",
  muted: "oklch(0.26 0.005 285)",
  mutedForeground: "oklch(0.7 0.02 260)",
  border: "oklch(0.3 0.005 285)",
  sidebar: "oklch(0.205 0.015 260)",
  sidebarForeground: "oklch(0.965 0.005 260)",
  sidebarBorder: "oklch(0.3 0.01 260)",
}

const mix = (a: string, b: string, pctA: number): string =>
  `color-mix(in oklab, ${a} ${pctA}%, ${b} ${100 - pctA}%)`

function computeThemeVars(
  colors: ThemeColors | undefined,
): Record<string, string> {
  if (!colors) return {}

  const hasTheme = Boolean(colors.mode || colors.primary_color)
  const vars: Record<string, string> = {}

  // Per-surface overrides (like checkout_navbar_bg) apply independently of
  // mode/primary so the admin can tweak a single color without committing to
  // the full design-token theme.
  if (colors.checkout_navbar_bg) {
    vars["--checkout-navbar-bg"] = colors.checkout_navbar_bg
    vars["--checkout-nav-bg"] = colors.checkout_navbar_bg
  }
  if (colors.checkout_subtitle_color) {
    vars["--checkout-subtitle"] = colors.checkout_subtitle_color
  }

  // If no mode/primary is set, stop here — rest of the palette stays on the
  // globals.css defaults.
  if (!hasTheme) return vars

  const mode: ThemeMode = colors.mode === "dark" ? "dark" : "light"
  const palette = mode === "dark" ? DARK : LIGHT
  const primary = colors.primary_color
  const primaryFg = colors.primary_foreground_color || "oklch(1 0 0)"

  Object.assign(vars, {
    // ─ Surface neutrals (always applied when a mode is chosen so the admin
    // can preview dark/light without committing to a primary).
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--card": palette.card,
    "--card-foreground": palette.foreground,
    "--popover": palette.popover,
    "--popover-foreground": palette.foreground,
    "--muted": palette.muted,
    "--muted-foreground": palette.mutedForeground,
    "--border": palette.border,
    "--input": palette.border,

    // ─ Portal semantic tokens
    "--heading": palette.foreground,
    "--heading-secondary": palette.foregroundSecondary,
    "--body": palette.foreground,
    "--pass-title": palette.foreground,
    "--pass-text": palette.foregroundSecondary,
    "--nav-text": palette.sidebarForeground,
    "--nav-text-secondary": palette.foregroundSecondary,

    // ─ Sidebar neutrals
    "--sidebar": palette.sidebar,
    "--sidebar-foreground": palette.sidebarForeground,
    "--sidebar-accent": mix(palette.sidebar, palette.sidebarForeground, 88),
    "--sidebar-accent-foreground": palette.sidebarForeground,
    "--sidebar-border": palette.sidebarBorder,

    // ─ Checkout neutrals
    "--checkout-title": palette.foreground,
    "--checkout-subtitle":
      colors.checkout_subtitle_color || palette.foregroundSecondary,
    "--checkout-watermark": mix(palette.background, palette.foreground, 92),
    "--checkout-navbar-bg":
      colors.checkout_navbar_bg || mix(palette.background, "transparent", 85),
    "--checkout-nav-bg":
      colors.checkout_navbar_bg || mix(palette.background, "transparent", 85),
    "--checkout-footer-bg": mix(palette.background, "transparent", 85),
    "--checkout-card-bg": palette.card,
    "--checkout-bottom-bar-bg": palette.sidebar,
    "--checkout-bottom-bar-text": palette.foreground,
  })

  // Brand-dependent tokens only fill in once the admin picked a primary —
  // otherwise we'd overwrite the nice shadcn default with nothing usable.
  if (primary) {
    const secondary = colors.secondary_color || palette.muted
    const hasSecondaryBrand = Boolean(colors.secondary_color)
    const accent = colors.accent_color || mix(palette.card, primary, 90)

    vars["--primary"] = primary
    vars["--primary-foreground"] = primaryFg
    vars["--secondary"] = secondary
    vars["--secondary-foreground"] = hasSecondaryBrand
      ? primaryFg
      : palette.foreground
    vars["--accent"] = accent
    vars["--accent-foreground"] = palette.foreground
    vars["--ring"] = primary
    vars["--sidebar-primary"] = primary
    vars["--sidebar-primary-foreground"] = primaryFg
    vars["--sidebar-ring"] = primary
    vars["--checkout-badge-bg"] = primary
    vars["--checkout-badge-title"] = primaryFg
    vars["--checkout-nav-text"] = primaryFg
    vars["--checkout-button"] = primary
    vars["--checkout-button-title"] = primaryFg
  }

  return vars
}

function buildThemeStyles(
  config: ThemeConfig | null | undefined,
): Record<string, string> {
  if (!config) return {}
  const styles: Record<string, string> = { ...computeThemeVars(config.colors) }

  if (config.typography?.font_base_size) {
    styles["--theme-font-base-size"] = config.typography.font_base_size
  }
  if (config.radius) styles["--radius"] = config.radius
  if (config.border_radius) styles["--border-radius"] = config.border_radius

  return styles
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const { getCity } = useCityProvider()
  const city = getCity()
  const themeConfig = city?.theme_config as ThemeConfig | null | undefined

  const themeStyles = useMemo(
    () => buildThemeStyles(themeConfig),
    [themeConfig],
  )

  // Apply the overrides to <html> so Radix Portals (dropdowns, popovers,
  // tooltips, dialogs) inherit the CSS variables — they render outside of
  // the React tree via document.body, so wrapping <div style> doesn't reach
  // them. Cleanup removes the overrides when the provider unmounts or the
  // theme changes, restoring the globals.css defaults.
  useEffect(() => {
    const root = document.documentElement
    const keys = Object.keys(themeStyles)
    if (keys.length === 0) return
    const previous: Record<string, string> = {}
    for (const key of keys) {
      previous[key] = root.style.getPropertyValue(key)
      root.style.setProperty(key, themeStyles[key])
    }
    // Base font size is a regular CSS property, not a custom prop.
    const fontSize = themeStyles["--theme-font-base-size"]
    const previousFontSize = fontSize ? root.style.fontSize : ""
    if (fontSize) root.style.fontSize = fontSize

    return () => {
      for (const key of keys) {
        if (previous[key]) root.style.setProperty(key, previous[key])
        else root.style.removeProperty(key)
      }
      if (fontSize) root.style.fontSize = previousFontSize
    }
  }, [themeStyles])

  return <>{children}</>
}
