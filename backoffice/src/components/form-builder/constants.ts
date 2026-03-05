import type { LucideIcon } from "lucide-react"
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  Hash,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  Mail,
  Type,
} from "lucide-react"
import type { FormFieldPublic, FormSectionPublic } from "@/client"

export interface FieldTypeDefinition {
  value: string
  label: string
  icon: LucideIcon
}

export const FIELD_TYPES: FieldTypeDefinition[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "textarea", label: "Text Area", icon: AlignLeft },
  { value: "number", label: "Number", icon: Hash },
  { value: "boolean", label: "Boolean (Yes/No)", icon: CheckSquare },
  { value: "select", label: "Select (Single)", icon: List },
  {
    value: "select_cards",
    label: "Single select (visible options)",
    icon: LayoutGrid,
  },
  { value: "multiselect", label: "Multi-Select", icon: ListChecks },
  { value: "date", label: "Date", icon: Calendar },
  { value: "email", label: "Email", icon: Mail },
  { value: "url", label: "URL", icon: Link },
]

export const FULL_WIDTH_TYPES = new Set([
  "textarea",
  "multiselect",
  "url",
  "select_cards",
])

export const PALETTE_ITEM_PREFIX = "palette-"
export const CANVAS_ITEM_PREFIX = "canvas-"

/** Prefix for sortable section DnD ids (section reorder). */
export const SORTABLE_SECTION_PREFIX = "sortable-section-"

export const getSortableSectionId = (sectionId: string): string =>
  SORTABLE_SECTION_PREFIX + sectionId

export const parseSortableSectionId = (id: string): string | null => {
  if (typeof id !== "string" || !id.startsWith(SORTABLE_SECTION_PREFIX))
    return null
  return id.slice(SORTABLE_SECTION_PREFIX.length) || null
}

export const slugify = (...parts: string[]): string =>
  parts
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_{2,}/g, "_")

/** Section is protected when API returns protected: true (cannot delete, limited edit). */
export const isSpecialSection = (section: FormSectionPublic | null): boolean =>
  !!section && section.protected === true

/** Field is protected when API returns protected: true (cannot delete, only placeholder/help text editable). */
export const isSpecialField = (field: FormFieldPublic): boolean =>
  field.protected === true
