/**
 * Pure helpers for the sales-flow "Inherited from event" override model
 * (design D1): every Class-B column on a flow is nullable, and NULL means
 * "read the popup column of the same name". These functions translate
 * between that nullable API shape and the two-mode form control
 * (inherit / override) the backoffice detail page renders per field.
 */
export type OverrideMode = "inherit" | "override"

/**
 * NULL/undefined on the flow means inherit; any other value, including
 * falsy ones like `false`, `0`, or `""`, is an explicit override and must
 * not be conflated with "no opinion".
 */
export function getOverrideMode<T>(value: T | null | undefined): OverrideMode {
  return value === null || value === undefined ? "inherit" : "override"
}

/**
 * Builds the value to send to the API for a single override field: null
 * when the field is set back to inherit (discarding any draft value the
 * user may have typed before switching modes), otherwise the draft value
 * itself, unchanged, so a legitimate falsy override survives.
 */
export function resolveOverrideValue<T>(
  mode: OverrideMode,
  draftValue: T,
): T | null {
  return mode === "override" ? draftValue : null
}
