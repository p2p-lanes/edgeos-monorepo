// Source-of-truth para mapear las claves del theme_config a CSS variables.
//
// Una clave del usuario puede expandirse a varias CSS variables (fan-out).
// Las claves "nuevas" (semánticas) cubren los campos editables del form;
// las claves "legacy" se siguen aceptando 1:1 para popups guardados antes
// de la simplificación.
//
// Mantener sincronizado con portal/src/providers/themeProvider.tsx.

export const NEW_THEME_KEYS = [
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

export type NewThemeKey = (typeof NEW_THEME_KEYS)[number]

export const NEW_KEY_DEFAULTS: Record<NewThemeKey, string> = {
  title_color: "#1a1a1a",
  subtitle_color: "#6b6b8a",
  button_color: "#2d3a6e",
  title_button_color: "#f5f5ff",
  primary_background_color: "#f5f5f5",
  sidebar_background_color: "#fafafa",
  card_background_color: "#ffffff",
  border_color: "#e5e5ee",
  sidebar_border_color: "#e5e5ee",
  // ─ checkout
  checkout_title_color: "#1a1a1a",
  checkout_watermark_color: "rgba(255, 255, 255, 0.85)",
  checkout_subtitle_color: "#6b6b8a",
  checkout_navbar_bg_color: "rgba(255, 255, 255, 0.85)",
  checkout_badge_bg_color: "#2d3a6e",
  checkout_badge_title_color: "#ffffff",
  checkout_card_bg_color: "#ffffff",
  checkout_bottom_bar_bg_color: "#1e2a4d",
  checkout_button_color: "#ffffff",
  checkout_button_title_color: "#1e2a4d",
  checkout_bottom_bar_text_color: "#ffffff",
}

// key -> [cssVar, ...]. Las nuevas claves son fan-out, las legacy 1:1.
export const THEME_KEY_EXPAND: Record<string, string[]> = {
  // ─ nuevas (semánticas) — portal
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

  // ─ legacy (1:1) — backwards compatibility para popups antiguos
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

const NEW_KEY_SET: ReadonlySet<string> = new Set(NEW_THEME_KEYS)

// Aplica las claves del theme a CSS variables. Las legacy van primero;
// las nuevas ganan en caso de colisión, así un popup que tiene ambas
// formas en el JSON se renderiza con la nueva como autoridad.
export function expandThemeColors(
  colors: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!colors) return out

  for (const [key, value] of Object.entries(colors)) {
    if (NEW_KEY_SET.has(key)) continue
    if (!value) continue
    const vars = THEME_KEY_EXPAND[key]
    if (!vars) continue
    for (const v of vars) out[v] = value
  }

  for (const key of NEW_THEME_KEYS) {
    const value = colors[key]
    if (!value) continue
    const vars = THEME_KEY_EXPAND[key]
    if (!vars) continue
    for (const v of vars) out[v] = value
  }

  return out
}

// Reverse map: legacy_key -> new_keys que lo afectan. Lo usa el ring de
// highlight del preview: cuando el usuario hace hover sobre `subtitle_color`
// queremos que se prendan los anillos de los componentes que internamente
// chequean por `heading_secondary`, `body`, `nav_text`, etc.
export const LEGACY_HIGHLIGHT_FROM_NEW: Record<string, string[]> = {
  heading: ["title_color"],
  pass_title: ["title_color"],
  heading_secondary: ["subtitle_color"],
  body: ["subtitle_color"],
  nav_text: ["subtitle_color"],
  nav_text_secondary: ["subtitle_color"],
  pass_text: ["subtitle_color"],
  primary: ["button_color"],
  primary_foreground: ["title_button_color"],
  background: ["primary_background_color"],
  sidebar: ["sidebar_background_color"],
  card: ["card_background_color"],
  popover: ["card_background_color"],
  border: ["border_color"],
  input: ["border_color"],
  sidebar_border: ["sidebar_border_color"],
  // ─ legacy checkout → new checkout
  checkout_nav_bg: ["checkout_navbar_bg_color"],
  checkout_nav_text: ["checkout_badge_title_color"],
}
