import type { AttendeeCategoryPublic } from "@/client"

/**
 * Resolves the display label for an attendee category.
 *
 * Priority:
 * 1. `display_meta.label` if non-null and non-empty
 * 2. i18n key `companions.add_{key}` via the provided `t` function
 * 3. Titlecase of `category.key` as final fallback
 */
export function resolveCategoryLabel(
  category: AttendeeCategoryPublic,
  t: (key: string) => string,
): string {
  const metaLabel = (category.display_meta as Record<string, unknown>)?.label
  if (metaLabel && typeof metaLabel === "string" && metaLabel.trim() !== "") {
    return metaLabel
  }

  const i18nKey = `companions.add_${category.key}`
  const translated = t(i18nKey)
  // If the translation function returns the key itself, no translation was found
  if (translated !== i18nKey) {
    return translated
  }

  // Final fallback: titlecase the key
  return category.key.charAt(0).toUpperCase() + category.key.slice(1)
}
