export type CheckoutNavVariant = "segmented" | "pills"

// Reads the popup's theme_config for the checkout nav layout selector.
// Defaults to "segmented" (the historical nav) for any missing/unknown value.
export function resolveNavVariant(themeConfig: unknown): CheckoutNavVariant {
  const value =
    themeConfig && typeof themeConfig === "object"
      ? (themeConfig as { checkout_nav_variant?: unknown }).checkout_nav_variant
      : undefined
  return value === "pills" ? "pills" : "segmented"
}
