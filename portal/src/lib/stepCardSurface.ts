import type { CSSProperties } from "react"

/**
 * Inline style for any "step card" surface in the checkout — ticket
 * sections, buyer form, confirm summary, FAQ items, cart drawer,
 * insurance card, etc.
 *
 * Re-binds the Tailwind palette CSS vars within the element's subtree to
 * the theme-configured card surface, with a multi-level fallback so
 * tenants that haven't set card colours still render coherently:
 *
 *   --step-card-bg      (theme `card_background_color`, or per-step
 *                        override applied on a parent wrapper)
 *     ↳ --checkout-card-bg  (legacy admin-configurable, kept for back-compat)
 *       ↳ --card             (Tailwind global, mode-driven default)
 *
 * Mirroring `--foreground` (and `--muted-foreground`, `--border`) to the
 * card fg colour means descendants that use `text-foreground` /
 * `text-muted-foreground` / `border-border` Tailwind classes also recolour
 * automatically — no per-component class surgery needed.
 */
export const stepCardSurfaceStyle = (): CSSProperties =>
  ({
    "--card": "var(--step-card-bg, var(--checkout-card-bg, var(--card)))",
    "--card-foreground": "var(--step-card-fg, var(--card-foreground))",
    "--foreground": "var(--step-card-fg, var(--card-foreground))",
    "--muted-foreground":
      "color-mix(in srgb, var(--step-card-fg, var(--card-foreground)) 75%, transparent)",
    // `--muted` paints `bg-muted` highlights inside the card (subtotal
    // row, disabled chips, icon backings). Tinting it with a slice of
    // the card-fg keeps these surfaces feeling integrated rather than
    // dropping out as the original grey-on-dark muted token.
    "--muted":
      "color-mix(in srgb, var(--step-card-fg, var(--card-foreground)) 8%, transparent)",
    "--border":
      "color-mix(in srgb, var(--step-card-fg, var(--card-foreground)) 18%, transparent)",
    // `--input` is the shadcn token for input-field borders specifically
    // (distinct from `--border` which covers card/section dividers).
    // Tie it to the same card-fg mix so inputs feel like part of the
    // card surface rather than picking up the global slate/black.
    "--input":
      "color-mix(in srgb, var(--step-card-fg, var(--card-foreground)) 25%, transparent)",
    background: "var(--step-card-bg, var(--checkout-card-bg, var(--card)))",
    color: "var(--step-card-fg, var(--card-foreground))",
  }) as CSSProperties
