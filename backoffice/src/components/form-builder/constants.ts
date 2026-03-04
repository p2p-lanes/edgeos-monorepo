import {
  AlignLeft,
  Calendar,
  CheckSquare,
  Hash,
  Link,
  List,
  ListChecks,
  Mail,
  Type,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
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
  { value: "multiselect", label: "Multi-Select", icon: ListChecks },
  { value: "date", label: "Date", icon: Calendar },
  { value: "email", label: "Email", icon: Mail },
  { value: "url", label: "URL", icon: Link },
]

export const FULL_WIDTH_TYPES = new Set(["textarea", "multiselect"])

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

/** Section labels that are protected: cannot be deleted, only label and order editable. */
export const SPECIAL_SECTION_LABELS: string[] = ["profile", "info not shared"]

/** Field labels that are protected: cannot be deleted, only label and position editable. */
export const SPECIAL_FIELD_LABELS: string[] = ['first name']

export const isSpecialSection = (
  section: FormSectionPublic | null,
): boolean =>
  !!section &&
  SPECIAL_SECTION_LABELS.includes((section.label ?? "").trim().toLowerCase())

export const isSpecialField = (field: FormFieldPublic): boolean =>
  SPECIAL_FIELD_LABELS.includes((field.label ?? "").trim().toLowerCase())
