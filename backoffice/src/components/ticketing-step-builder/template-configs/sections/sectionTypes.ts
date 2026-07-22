export interface SectionVisibilityCondition {
  field_id: string
  value: string | string[]
}

export interface ProductSection {
  key: string
  label: string
  order: number
  product_ids: string[]
  description?: string
  image_url?: string
  attendee_categories?: string[] | null
  visible_if?: SectionVisibilityCondition | null
}

export interface VisibilityFormFieldOption {
  /** FormField.name — stable key persisted in custom_fields */
  name: string
  /** Human-readable label for the dropdown */
  label: string
  /** Discrete options to choose from */
  options: string[]
}

export interface SectionProduct {
  id: string
  name: string
  price?: string
  slug?: string
  is_active?: boolean
}

export interface AttendeeCategoryOption {
  id: string
  key: string
  label: string
}

export function parseConfigSections(config: Record<string, unknown> | null): {
  sections: ProductSection[]
} {
  if (!config || !Array.isArray(config.sections)) {
    return { sections: [] }
  }
  return config as unknown as { sections: ProductSection[] }
}

export function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
