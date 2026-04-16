"use client"

import { type ReactNode, useMemo } from "react"
import { useCityProvider } from "./cityProvider"

type ThemeColors = Record<string, string>
type ThemeTypography = {
  font_base_size?: string
  font_heading_scale?: number
}
type ThemeConfig = {
  colors?: ThemeColors
  typography?: ThemeTypography
  radius?: string
  border_radius?: string
}

// Mantener sincronizado con
// backoffice/src/components/forms/ThemePreview/themeExpand.ts
const NEW_THEME_KEYS = [
  // ─ portal
  "title_color",
  "subtitle_color",
  "button_color",
  "title_button_color",
  "primary_background_color",
  "sidebar_background_color",
  "card_background_color",
  "border_color",
  "sidebar_border_color",
  // ─ checkout
  "checkout_title_color",
  "checkout_watermark_color",
  "checkout_subtitle_color",
  "checkout_navbar_bg_color",
  "checkout_badge_bg_color",
  "checkout_badge_title_color",
  "checkout_card_bg_color",
  "checkout_bottom_bar_bg_color",
  "checkout_button_color",
  "checkout_button_title_color",
  "checkout_bottom_bar_text_color",
] as const

const NEW_KEY_SET: ReadonlySet<string> = new Set(NEW_THEME_KEYS)

const THEME_KEY_EXPAND: Record<string, string[]> = {
  // ─ nuevas (fan-out)
  title_color: ["--heading", "--pass-title"],
  subtitle_color: [
    "--heading-secondary",
    "--body",
    "--nav-text",
    "--nav-text-secondary",
    "--pass-text",
  ],
  button_color: ["--primary"],
  title_button_color: ["--primary-foreground"],
  primary_background_color: ["--background"],
  sidebar_background_color: ["--sidebar"],
  card_background_color: ["--card", "--popover"],
  border_color: ["--border", "--input"],
  sidebar_border_color: ["--sidebar-border"],

  // ─ nuevas (semánticas) — checkout
  checkout_title_color: ["--checkout-title"],
  checkout_watermark_color: ["--checkout-watermark"],
  checkout_subtitle_color: ["--checkout-subtitle"],
  checkout_navbar_bg_color: ["--checkout-navbar-bg", "--checkout-nav-bg"],
  checkout_badge_bg_color: ["--checkout-badge-bg"],
  checkout_badge_title_color: ["--checkout-badge-title", "--checkout-nav-text"],
  checkout_card_bg_color: ["--checkout-card-bg"],
  checkout_bottom_bar_bg_color: ["--checkout-bottom-bar-bg"],
  checkout_button_color: ["--checkout-button"],
  checkout_button_title_color: ["--checkout-button-title"],
  checkout_bottom_bar_text_color: ["--checkout-bottom-bar-text"],

  // ─ legacy (1:1) — popups creados antes de la simplificación
  background: ["--background"],
  foreground: ["--foreground"],
  heading: ["--heading"],
  heading_secondary: ["--heading-secondary"],
  body: ["--body"],
  nav_text: ["--nav-text"],
  nav_text_secondary: ["--nav-text-secondary"],
  pass_title: ["--pass-title"],
  pass_text: ["--pass-text"],
  checkout_nav_bg: ["--checkout-nav-bg"],
  checkout_nav_text: ["--checkout-nav-text"],
  primary: ["--primary"],
  primary_foreground: ["--primary-foreground"],
  secondary: ["--secondary"],
  secondary_foreground: ["--secondary-foreground"],
  card: ["--card"],
  card_foreground: ["--card-foreground"],
  popover: ["--popover"],
  popover_foreground: ["--popover-foreground"],
  muted: ["--muted"],
  muted_foreground: ["--muted-foreground"],
  accent: ["--accent"],
  accent_foreground: ["--accent-foreground"],
  destructive: ["--destructive"],
  destructive_foreground: ["--destructive-foreground"],
  border: ["--border"],
  input: ["--input"],
  ring: ["--ring"],
  sidebar: ["--sidebar"],
  sidebar_foreground: ["--sidebar-foreground"],
  sidebar_primary: ["--sidebar-primary"],
  sidebar_primary_foreground: ["--sidebar-primary-foreground"],
  sidebar_accent: ["--sidebar-accent"],
  sidebar_accent_foreground: ["--sidebar-accent-foreground"],
  sidebar_border: ["--sidebar-border"],
  sidebar_ring: ["--sidebar-ring"],
}

function buildThemeStyles(
  config: ThemeConfig | null | undefined,
): React.CSSProperties {
  if (!config) return {}

  const styles: Record<string, string> = {}

  if (config.colors) {
    // Legacy primero
    for (const [key, value] of Object.entries(config.colors)) {
      if (NEW_KEY_SET.has(key)) continue
      if (!value) continue
      const vars = THEME_KEY_EXPAND[key]
      if (!vars) continue
      for (const v of vars) styles[v] = value
    }
    // Nuevas después → ganan en colisión
    for (const key of NEW_THEME_KEYS) {
      const value = config.colors[key]
      if (!value) continue
      const vars = THEME_KEY_EXPAND[key]
      if (!vars) continue
      for (const v of vars) styles[v] = value
    }
  }

  if (config.typography?.font_base_size) {
    styles["--theme-font-base-size"] = config.typography.font_base_size
    styles.fontSize = config.typography.font_base_size
  }

  if (config.radius) {
    styles["--radius"] = config.radius
  }

  if (config.border_radius) {
    styles["--border-radius"] = config.border_radius
  }

  return styles as React.CSSProperties
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const { getCity } = useCityProvider()
  const city = getCity()
  const themeConfig = city?.theme_config as ThemeConfig | null | undefined

  const themeStyles = useMemo(
    () => buildThemeStyles(themeConfig),
    [themeConfig],
  )

  const hasOverrides = Object.keys(themeStyles).length > 0

  if (!hasOverrides) {
    return <>{children}</>
  }

  return <div style={themeStyles}>{children}</div>
}
