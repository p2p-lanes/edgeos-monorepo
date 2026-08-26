"use client"

import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react"
import { buildGoogleFontsUrl, toCssFontFamily } from "@/lib/google-font"
import { CityContext } from "./cityProvider"

const ThemeScopeContext = createContext<CSSProperties | undefined>(undefined)

export function useThemeScopeStyle() {
  return useContext(ThemeScopeContext)
}

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
  /** Google Fonts family for body text, e.g. "Inter". Loaded at runtime from
   *  fonts.googleapis.com — `next/font` can't help here because it resolves
   *  families at build time and this one comes from the database. */
  font_family?: string
  /** Optional separate family for h1–h6. Falls back to `font_family`. */
  font_heading_family?: string
}

interface ThemeColors {
  mode?: ThemeMode
  primary_color?: string
  primary_foreground_color?: string
  secondary_color?: string
  accent_color?: string
  checkout_navbar_bg?: string
  checkout_subtitle_color?: string
  checkout_bottom_bar_bg_color?: string
  checkout_bottom_bar_text_color?: string
  /** Optional override for the watermark (giant section-name text behind
   *  the snap header). Defaults to a 92% bg-mix of the foreground so it
   *  sits quietly behind the title, but on dark hero photos that becomes
   *  invisible — tenants that want it visible can set e.g. an rgba white. */
  checkout_watermark_color?: string
  /** Optional override for the step-nav text + icon colour. Required when
   *  the admin picks a `checkout_navbar_bg` that doesn't match the chosen
   *  `mode` (e.g. dark-teal navbar in a light-mode popup): without this
   *  the nav labels default to muted-foreground and disappear against the
   *  dark fill. Applied to both active and inactive nav items. */
  checkout_nav_text_color?: string
  /** When true, native emojis in the nav are forced to a single tone via
   *  CSS `filter` (the default chain inverts to white, which works on dark
   *  navbars). Pass a custom filter string to override the default. Useful
   *  when the admin wants the emoji palette to feel "monochrome iconography"
   *  rather than OS-coloured pictographs. */
  checkout_nav_monochrome_emoji?: boolean | string
  /** Override the universal step-card surface for the whole popup.
   *  Drives `--step-card-bg` and `--step-card-fg`, consumed by every
   *  card-like surface in the checkout (ticket sections, buyer form,
   *  confirm summary, FAQ items, cart drawer, insurance card). Use when
   *  the popup theme mode and the card surface need to disagree — e.g.
   *  a dark popup with cream-on-teal cards. */
  card_background_color?: string
  card_foreground_color?: string
}

export interface ThemeConfig {
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
  if (colors.checkout_bottom_bar_bg_color) {
    vars["--checkout-bottom-bar-bg"] = colors.checkout_bottom_bar_bg_color
  }
  if (colors.checkout_bottom_bar_text_color) {
    vars["--checkout-bottom-bar-text"] = colors.checkout_bottom_bar_text_color
  }
  if (colors.checkout_nav_text_color) {
    // Force nav text/icon colour for both active and inactive states. The
    // disabled token uses a slight opacity so the inactive labels still
    // recede visually without becoming unreadable.
    vars["--checkout-badge-title"] = colors.checkout_nav_text_color
    vars["--checkout-nav-text"] = colors.checkout_nav_text_color
    vars["--checkout-badge-title-disabled"] =
      `color-mix(in srgb, ${colors.checkout_nav_text_color} 70%, transparent)`
  }
  if (colors.checkout_nav_monochrome_emoji) {
    // Native emojis ignore CSS `color`, so we use `filter` to force them
    // to a single tone. Default chain inverts to white (works on dark
    // navbars); a custom filter string is plumbed through as-is.
    vars["--checkout-nav-emoji-filter"] =
      typeof colors.checkout_nav_monochrome_emoji === "string"
        ? colors.checkout_nav_monochrome_emoji
        : "brightness(0) saturate(0) invert(1)"
  }
  // Universal step-card surface — written outside the `hasTheme` guard so
  // tenants can opt into card colours without committing to a full
  // mode/primary theme. Consumed by every card surface in the checkout
  // via `stepCardSurfaceStyle()` (see `portal/src/lib/stepCardSurface.ts`),
  // which reads `var(--step-card-bg, …)` and re-binds `--card`,
  // `--foreground`, `--muted-foreground`, `--border` for its subtree.
  if (colors.card_background_color) {
    vars["--step-card-bg"] = colors.card_background_color
  }
  if (colors.card_foreground_color) {
    vars["--step-card-fg"] = colors.card_foreground_color
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
    "--checkout-watermark":
      colors.checkout_watermark_color ||
      mix(palette.background, palette.foreground, 92),
    "--checkout-navbar-bg":
      colors.checkout_navbar_bg || mix(palette.background, "transparent", 85),
    "--checkout-nav-bg":
      colors.checkout_navbar_bg || mix(palette.background, "transparent", 85),
    "--checkout-footer-bg": mix(palette.background, "transparent", 85),
    "--checkout-card-bg": palette.card,
  })

  // --checkout-bottom-bar-bg / -text are deliberately NOT derived from the
  // palette. Keeping them on the globals.css defaults (or the per-surface
  // override above) avoids blending the floating footer into the page bg
  // when the admin has only chosen mode/primary.

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

  // Font families are validated here rather than at the point of use so an
  // invalid value from the database is dropped once, not partially applied.
  const bodyFont = toCssFontFamily(config.typography?.font_family ?? "")
  if (bodyFont) styles["--theme-font-family"] = bodyFont
  const headingFont = toCssFontFamily(
    config.typography?.font_heading_family ?? "",
  )
  if (headingFont) styles["--theme-font-heading-family"] = headingFont

  if (config.radius) styles["--radius"] = config.radius
  if (config.border_radius) styles["--border-radius"] = config.border_radius

  return styles
}

export default function ThemeProvider({
  children,
  config,
  scope = "document",
}: {
  children: ReactNode
  /**
   * The theme to apply instead of the gathering's own.
   *
   * A sales flow chooses how its checkout looks
   * (sdd/sales-flows-rediseno), and outside checkout no flow is in scope,
   * so the gathering's theme dresses its own pages. Passing this REPLACES
   * the gathering's rather than layering on top: two writers to the same
   * CSS variables would depend on effect ordering, and React runs child
   * effects before parent ones.
   */
  config?: ThemeConfig | null
  /** Applies flow tokens to the checkout subtree instead of the document. */
  scope?: "document" | "local"
}) {
  // The raw context, not `useCityProvider`, which throws when there is no
  // CityProvider above. The checkout mounts this provider with an explicit
  // `config` and has no CityProvider of its own, so demanding one would
  // take the page down to read a value it was never going to use.
  const cityContext = useContext(CityContext)
  const city = cityContext?.getCity()
  const themeConfig =
    config !== undefined
      ? config
      : (city?.theme_config as ThemeConfig | null | undefined)

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
    if (scope !== "document") return

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

    // The body font has to be set as a real `font-family` on <body>, not just
    // via `--font-sans`: layout.tsx puts `GeistSans.className` on <body>, and
    // that class declares font-family directly, so it beats the Tailwind
    // variable. `--font-sans` is set too, for elements that opt in with an
    // explicit `font-sans` utility.
    //
    // Checkout skins are unaffected: they declare font-family on their own
    // wrapper (`.checkout-amanita`), and a rule that matches an element always
    // beats a value inherited from <body>. Do not make this `!important`.
    const body = document.body
    const bodyFont = themeStyles["--theme-font-family"]
    const previousBodyFont = bodyFont ? body.style.fontFamily : ""
    const previousFontSans = bodyFont
      ? root.style.getPropertyValue("--font-sans")
      : ""
    if (bodyFont) {
      body.style.fontFamily = bodyFont
      root.style.setProperty("--font-sans", bodyFont)
    }

    return () => {
      for (const key of keys) {
        if (previous[key]) root.style.setProperty(key, previous[key])
        else root.style.removeProperty(key)
      }
      if (fontSize) root.style.fontSize = previousFontSize
      if (bodyFont) {
        body.style.fontFamily = previousBodyFont
        if (previousFontSans) {
          root.style.setProperty("--font-sans", previousFontSans)
        } else {
          root.style.removeProperty("--font-sans")
        }
      }
    }
  }, [scope, themeStyles])

  const fontSize = themeStyles["--theme-font-base-size"]
  const localStyles: CSSProperties = {
    ...themeStyles,
    ...(fontSize ? { fontSize } : {}),
  }

  // Load the picked families from Google. Separate from the effect above
  // because it keys off the raw family names, not the derived CSS values, and
  // because the <link> outlives a colour-only theme change.
  //
  // This runs client-side, so the webfont arrives after hydration and after
  // the tenant fetch resolves — `display=swap` means a flash of the fallback
  // stack rather than invisible text. Emitting the <link> from the server
  // render would remove the flash; see docs/google-fonts-theme-plan.md.
  useEffect(() => {
    const typography = themeConfig?.typography
    const href = buildGoogleFontsUrl([
      typography?.font_family,
      typography?.font_heading_family,
    ])
    if (!href) return

    // Two popups on the same session can ask for the same family; a second
    // identical <link> would be a redundant request. Compared by attribute
    // rather than through a selector so the href never has to be escaped.
    const alreadyLoaded = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).some((link) => link.getAttribute("href") === href)
    if (alreadyLoaded) return

    // Preconnect to the font CDN as well as the stylesheet host: the CSS and
    // the woff2 files come from different origins, and the second handshake
    // would otherwise start only once the CSS has parsed.
    const preconnects = [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ].map((origin) => {
      const link = document.createElement("link")
      link.rel = "preconnect"
      link.href = origin
      // gstatic serves the fonts with CORS; the hint has to match the request
      // mode or the warmed connection goes unused.
      if (origin.includes("gstatic")) link.crossOrigin = "anonymous"
      document.head.appendChild(link)
      return link
    })

    const stylesheet = document.createElement("link")
    stylesheet.rel = "stylesheet"
    stylesheet.href = href
    document.head.appendChild(stylesheet)

    return () => {
      stylesheet.remove()
      for (const link of preconnects) link.remove()
    }
  }, [themeConfig?.typography])

  if (scope === "local") {
    return (
      <ThemeScopeContext.Provider value={localStyles}>
        <div style={localStyles}>{children}</div>
      </ThemeScopeContext.Provider>
    )
  }

  return (
    <ThemeScopeContext.Provider value={undefined}>
      {children}
    </ThemeScopeContext.Provider>
  )
}
