import type { PreviewTab } from "./types"

// LEGACY 1:1 mapping color_key -> CSS variable. Mantenido para referencia y
// compatibilidad. La fuente de verdad para aplicar colores es ahora
// `themeExpand.ts` (ahí viven las nuevas keys + el fan-out + las legacy).
// MUST stay in sync con portal/src/providers/themeProvider.tsx.
export const CSS_VAR_MAP: Record<string, string> = {
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
export const PORTAL_DEFAULT_VARS: Record<string, string> = {
  "--radius": "0.5rem",
  "--border-radius": "0.5rem",
  "--background": "oklch(1 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--heading": "oklch(0.145 0 0)",
  "--heading-secondary": "oklch(0.556 0.01 260)",
  "--body": "oklch(0.145 0 0)",
  "--nav-text": "oklch(0.145 0 0)",
  "--nav-text-secondary": "oklch(0.556 0.01 260)",
  "--pass-title": "oklch(0.145 0 0)",
  "--pass-text": "oklch(0.556 0.01 260)",
  "--checkout-nav-bg": "rgba(255, 255, 255, 0.85)",
  "--checkout-nav-text": "#ffffff",
  "--checkout-title": "#1a1a1a",
  "--checkout-watermark": "rgba(255, 255, 255, 0.85)",
  "--checkout-subtitle": "#6b6b8a",
  "--checkout-navbar-bg": "rgba(255, 255, 255, 0.85)",
  "--checkout-badge-bg": "#2d3a6e",
  "--checkout-badge-title": "#ffffff",
  "--checkout-card-bg": "#ffffff",
  "--checkout-bottom-bar-bg": "#1e2a4d",
  "--checkout-button": "#ffffff",
  "--checkout-button-title": "#1e2a4d",
  "--checkout-bottom-bar-text": "#ffffff",
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

// Home tab contains the entire portal home layout including the left sidebar,
// header bar, event card and progress bar. Checkout tab shows the
// ScrollyCheckoutFlow. Every color token lives in one of the two — checkout_*
// goes to checkout, everything else to home.
export const TAB_OF_KEY: Record<string, PreviewTab> = {
  // ─ nuevas keys portal
  title_color: "home",
  subtitle_color: "home",
  button_color: "home",
  title_button_color: "home",
  primary_background_color: "home",
  sidebar_background_color: "home",
  card_background_color: "home",
  border_color: "home",
  sidebar_border_color: "home",
  // ─ nuevas keys checkout
  checkout_title_color: "checkout",
  checkout_watermark_color: "checkout",
  checkout_subtitle_color: "checkout",
  checkout_navbar_bg_color: "checkout",
  checkout_badge_bg_color: "checkout",
  checkout_badge_title_color: "checkout",
  checkout_card_bg_color: "checkout",
  checkout_bottom_bar_bg_color: "checkout",
  checkout_button_color: "checkout",
  checkout_button_title_color: "checkout",
  checkout_bottom_bar_text_color: "checkout",
  // ─ legacy
  background: "home",
  foreground: "home",
  heading: "home",
  heading_secondary: "home",
  body: "home",
  nav_text: "home",
  nav_text_secondary: "home",
  primary: "home",
  primary_foreground: "home",
  secondary: "home",
  secondary_foreground: "home",
  accent: "home",
  accent_foreground: "home",
  ring: "home",
  card: "home",
  card_foreground: "home",
  pass_title: "home",
  pass_text: "home",
  popover: "home",
  popover_foreground: "home",
  muted: "home",
  muted_foreground: "home",
  destructive: "home",
  destructive_foreground: "home",
  border: "home",
  input: "home",
  checkout_nav_bg: "checkout",
  checkout_nav_text: "checkout",
  sidebar: "home",
  sidebar_foreground: "home",
  sidebar_primary: "home",
  sidebar_primary_foreground: "home",
  sidebar_accent: "home",
  sidebar_accent_foreground: "home",
  sidebar_border: "home",
  sidebar_ring: "home",
}

export const TAB_LABELS: Record<PreviewTab, string> = {
  home: "Home",
  checkout: "Checkout",
}

export const TABS: readonly PreviewTab[] = ["home", "checkout"] as const

// Native (pre-scale) viewport. The portal is designed around ~760px content
// columns; we draw at that width and scale down to fit the right column of
// the form. Height was tuned to fit the Home layout without excess white
// space below the EventCard.
export const NATIVE_WIDTH = 760
export const NATIVE_HEIGHT = 820
export const SCALE = 0.5
export const VIEWPORT_WIDTH = NATIVE_WIDTH * SCALE
export const VIEWPORT_HEIGHT = NATIVE_HEIGHT * SCALE
