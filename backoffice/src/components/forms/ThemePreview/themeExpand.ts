// Design-token theme system — keep in sync with
// portal/src/providers/themeProvider.tsx.
//
// The admin picks a mode + primary + optional secondary/accent. Every other
// surface-level CSS variable is derived from those via color-mix.

export type ThemeMode = "light" | "dark"

export interface ThemeColors {
  mode?: ThemeMode
  primary_color?: string
  primary_foreground_color?: string
  secondary_color?: string
  accent_color?: string
  checkout_navbar_bg?: string
  checkout_subtitle_color?: string
}

// Editable keys shown in the backoffice form. Anything else in
// colors.* is ignored (old popups still have legacy keys in their JSONB
// blob — we don't migrate, just stop reading them).
export const NEW_THEME_KEYS = [
  "mode",
  "primary_color",
  "primary_foreground_color",
  "secondary_color",
  "accent_color",
  "checkout_navbar_bg",
  "checkout_subtitle_color",
] as const

export type NewThemeKey = (typeof NEW_THEME_KEYS)[number]

export const NEW_KEY_DEFAULTS: Record<NewThemeKey, string> = {
  mode: "light",
  primary_color: "#2d3a6e",
  primary_foreground_color: "#ffffff",
  secondary_color: "",
  accent_color: "",
  checkout_navbar_bg: "",
  checkout_subtitle_color: "",
}

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

export function computeThemeVars(
  colors: ThemeColors | undefined,
): Record<string, string> {
  if (!colors) return {}

  const overrides: Record<string, string> = {}
  // Per-surface overrides apply independently of mode/primary so the admin
  // can tweak a single color without committing to the full design-token
  // theme.
  if (colors.checkout_subtitle_color) {
    overrides["--checkout-subtitle"] = colors.checkout_subtitle_color
  }

  if (!colors.mode && !colors.primary_color) return overrides

  const mode: ThemeMode = colors.mode === "dark" ? "dark" : "light"
  const palette = mode === "dark" ? DARK : LIGHT
  const primary = colors.primary_color
  const primaryFg = colors.primary_foreground_color || "oklch(1 0 0)"

  const vars: Record<string, string> = {
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

    "--heading": palette.foreground,
    "--heading-secondary": palette.foregroundSecondary,
    "--body": palette.foreground,
    "--pass-title": palette.foreground,
    "--pass-text": palette.foregroundSecondary,
    "--nav-text": palette.sidebarForeground,
    "--nav-text-secondary": palette.foregroundSecondary,

    "--sidebar": palette.sidebar,
    "--sidebar-foreground": palette.sidebarForeground,
    "--sidebar-accent": mix(palette.sidebar, palette.sidebarForeground, 88),
    "--sidebar-accent-foreground": palette.sidebarForeground,
    "--sidebar-border": palette.sidebarBorder,

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
  }

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

// Back-compat shim for the existing preview hook — it used to merge legacy
// keys + new keys into a single CSS var map. Now it's just computeThemeVars.
export function expandThemeColors(
  colors: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return computeThemeVars(colors as ThemeColors | undefined)
}

// Preview components ring by internal token names ("primary", "heading",
// "checkout_button", …). Hovering any brand field should light those up.
// Map token → which editable key drives it so hover state propagates.
export const LEGACY_HIGHLIGHT_FROM_NEW: Record<string, string[]> = {
  // Brand tokens
  primary: ["primary_color"],
  primary_foreground: ["primary_foreground_color"],
  secondary: ["secondary_color"],
  secondary_foreground: ["primary_foreground_color"],
  accent: ["accent_color"],
  accent_foreground: ["mode"],
  ring: ["primary_color"],
  // Portal surfaces derived from mode
  heading: ["mode"],
  heading_secondary: ["mode"],
  body: ["mode"],
  nav_text: ["mode"],
  nav_text_secondary: ["mode"],
  pass_title: ["mode"],
  pass_text: ["mode"],
  background: ["mode"],
  foreground: ["mode"],
  card: ["mode"],
  card_foreground: ["mode"],
  popover: ["mode"],
  popover_foreground: ["mode"],
  muted: ["mode"],
  muted_foreground: ["mode"],
  border: ["mode"],
  input: ["mode"],
  sidebar: ["mode"],
  sidebar_foreground: ["mode"],
  sidebar_primary: ["primary_color"],
  sidebar_primary_foreground: ["primary_foreground_color"],
  sidebar_accent: ["mode"],
  sidebar_accent_foreground: ["mode"],
  sidebar_border: ["mode"],
  // Checkout
  checkout_title: ["mode"],
  checkout_subtitle: ["checkout_subtitle_color", "mode"],
  checkout_subtitle_color: ["checkout_subtitle_color", "mode"],
  checkout_watermark: ["mode"],
  checkout_navbar_bg: ["checkout_navbar_bg", "mode"],
  checkout_nav_bg: ["checkout_navbar_bg", "mode"],
  checkout_nav_text: ["primary_foreground_color"],
  checkout_badge_bg: ["primary_color"],
  checkout_badge_title: ["primary_foreground_color"],
  checkout_card_bg: ["mode"],
  checkout_bottom_bar_bg: ["mode"],
  checkout_bottom_bar_text: ["mode"],
  checkout_button: ["primary_color"],
  checkout_button_title: ["primary_foreground_color"],
}
