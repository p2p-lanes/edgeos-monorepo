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
}

const COLOR_KEY_TO_CSS_VAR: Record<string, string> = {
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

function buildThemeStyles(
  config: ThemeConfig | null | undefined,
): React.CSSProperties {
  if (!config) return {}

  const styles: Record<string, string> = {}

  if (config.colors) {
    for (const [key, value] of Object.entries(config.colors)) {
      const cssVar = COLOR_KEY_TO_CSS_VAR[key]
      if (cssVar && value) {
        styles[cssVar] = value
      }
    }
  }

  if (config.typography?.font_base_size) {
    styles["--theme-font-base-size"] = config.typography.font_base_size
    styles.fontSize = config.typography.font_base_size
  }

  if (config.radius) {
    styles["--radius"] = config.radius
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
