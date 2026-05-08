/** Normalise an attendee.category string to the 3-value backend enum.
 *  teen → kid, baby → kid. Other values pass through unchanged so the
 *  result is still typed `string` for callers that compare against
 *  `AttendeeCategory[]`. */
export function normalizeAttendeeCategory(raw: string): string {
  if (raw === "teen" || raw === "baby") return "kid"
  return raw
}
