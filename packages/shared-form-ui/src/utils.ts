import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const FULL_WIDTH_TYPES = new Set([
  "textarea",
  "multiselect",
  "url",
  "select_cards",
  "rich_text",
  "image_upload",
  "country_select",
  "signature",
])

/** Resolve a field's column width. Explicit `width` wins; otherwise apply the
 * type-based heuristic so existing forms keep the same layout. */
export function resolveFieldWidth(field: {
  type?: string
  field_type?: string
  width?: "full" | "half" | null
}): "full" | "half" {
  if (field.width === "full" || field.width === "half") return field.width
  const t = field.field_type ?? field.type
  return t && FULL_WIDTH_TYPES.has(t) ? "full" : "half"
}
