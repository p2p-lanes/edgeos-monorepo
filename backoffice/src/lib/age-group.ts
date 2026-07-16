/**
 * Helper for attendees that collect an `age_group` (baby/kid/teen) in their
 * `additional_data` blob (the "kid" category). The portal collects it; the
 * backoffice only displays it.
 */

/**
 * Read the `age_group` value from an attendee's `additional_data` blob.
 * Falls back to a legacy `age` key for older records. Returns null when absent.
 */
export function readAgeGroup(
  attendee: { additional_data?: unknown } | null | undefined,
): string | null {
  const value = attendee?.additional_data
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null
  if (!data) return null
  const raw = data.age_group ?? data.age
  return typeof raw === "string" && raw !== "" ? raw : null
}
