/**
 * Resolves the price mode for a patron step from its template_config.
 *
 * Design §5 ADR-4: use `template_config.price_mode = "fixed" | "variable"`.
 * Defaults to "variable" when unset to preserve bit-for-bit behavior for
 * existing patron steps (which today always use variable pricing).
 */

export type PatronPriceMode = "fixed" | "variable"

/**
 * Returns "variable" or "fixed" based on the step's template_config.
 *
 * Defaults to "variable" when:
 * - templateConfig is null/undefined
 * - price_mode is not set
 * - price_mode is an unrecognized value (forward-compat for future modes)
 */
export function resolvePatronPriceMode(
  templateConfig: Record<string, unknown> | null | undefined,
): PatronPriceMode {
  if (!templateConfig) return "variable"
  const mode = templateConfig.price_mode
  if (mode === "fixed" || mode === "variable") return mode
  // Legacy: no explicit mode set. Default to variable to preserve current
  // behavior for existing patron steps.
  return "variable"
}
