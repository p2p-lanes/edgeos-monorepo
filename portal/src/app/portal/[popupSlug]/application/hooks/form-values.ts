/** Narrow a Record<string, unknown> value to a specific shape at call sites.
 *
 * The form state is heterogeneous (string, boolean, string[], etc.), so values
 * come back as `unknown`. These helpers replace `value as string` casts with
 * runtime-checked reads that return a safe fallback when the shape is wrong.
 */

export function getString(
  values: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const v = values[key]
  return typeof v === "string" ? v : fallback
}

export function getBoolean(
  values: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const v = values[key]
  return typeof v === "boolean" ? v : fallback
}
