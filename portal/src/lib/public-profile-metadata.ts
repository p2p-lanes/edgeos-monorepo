// Reserved assessment keys must not travel through checkout metadata, including
// drafts restored from an older browser cache. Only filter the profile root;
// nested form answers are not human assessment fields.
const ADMIN_PROFILE_FIELDS = new Set(["rating", "red_flag", "enriched_profile"])

export function publicProfileMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(
      ([key]) => !ADMIN_PROFILE_FIELDS.has(key),
    ),
  )
}
