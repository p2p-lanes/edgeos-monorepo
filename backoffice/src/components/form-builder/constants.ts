import type { FormFieldSchema } from "@edgeos/shared-form-ui"
import { resolveFieldWidth as resolveFieldWidthShared } from "@edgeos/shared-form-ui"
import type { LucideIcon } from "lucide-react"
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  Circle,
  FileText,
  Globe,
  Hash,
  Image,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  ListFilter,
  Mail,
  PenLine,
  Phone,
  Type,
} from "lucide-react"
import type { FormFieldPublic, FormSectionPublic } from "@/client"

/** Map API form field to shared FormFieldSchema for SchemaField / portal-style components. */
export function formFieldPublicToFormFieldSchema(
  f: FormFieldPublic,
): FormFieldSchema {
  return {
    type: f.field_type as FormFieldSchema["type"],
    label: f.label,
    required: f.required ?? false,
    section_id: f.section_id ?? null,
    position: f.position,
    options: f.options ?? undefined,
    placeholder: f.placeholder ?? undefined,
    help_text: f.help_text ?? undefined,
    target: (f.target as "human" | "application") ?? undefined,
    min_date: f.min_date ?? null,
    max_date: f.max_date ?? null,
    config: f.config ?? undefined,
    width: f.width ?? null,
  }
}

/** Resolve the canvas column width for a FormFieldPublic. Delegates to the
 * shared helper so the backoffice canvas matches the portal exactly. */
export function resolveFieldWidth(
  field: FormFieldPublic | FormFieldSchema,
): "full" | "half" {
  const t = "field_type" in field ? field.field_type : field.type
  const w =
    "width" in field
      ? (field.width as "full" | "half" | null | undefined)
      : null
  return resolveFieldWidthShared({ type: t, field_type: t, width: w ?? null })
}

/** Preview value for a field type (for form builder canvas). */
export function getPreviewValueForFieldType(
  field: FormFieldPublic,
): string | string[] | boolean {
  switch (field.field_type) {
    case "boolean":
      return false
    case "rich_text":
      // Checkbox mode treats value as bool; display-only ignores value.
      return false
    case "multiselect":
      return (field.options ?? []).slice(0, 2)
    case "multiselect_detailed":
      return (field.options ?? []).slice(0, 2)
    case "select_cards":
    case "select":
      return (field.options ?? [])[0] ?? ""
    case "radio":
      return (field.options ?? [])[0] ?? ""
    default:
      return ""
  }
}

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
  {
    value: "multiselect",
    label: "Pills (multiple selections)",
    icon: ListChecks,
  },
  { value: "radio", label: "Radio list", icon: Circle },
  {
    value: "multiselect_detailed",
    label: "Multi-select (detailed)",
    icon: ListFilter,
  },
  { value: "date", label: "Date", icon: Calendar },
  { value: "email", label: "Email", icon: Mail },
  { value: "phone", label: "Phone", icon: Phone },
  { value: "url", label: "URL", icon: Link },
  { value: "rich_text", label: "Text with link", icon: FileText },
  { value: "image_upload", label: "Image upload", icon: Image },
  { value: "country_select", label: "Country", icon: Globe },
  { value: "signature", label: "Signature", icon: PenLine },
]

export const FULL_WIDTH_TYPES = new Set([
  "textarea",
  "multiselect",
  "multiselect_detailed",
  "radio",
  "url",
  "select_cards",
  "rich_text",
  "image_upload",
  "country_select",
  "signature",
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

/** Field is protected when API returns protected: true (originates from the base catalog). */
export const isSpecialField = (field: FormFieldPublic): boolean =>
  field.protected === true

/** A protected field can still be removed from the popup when the catalog marks it as removable. */
export const canRemoveField = (field: FormFieldPublic): boolean =>
  !isSpecialField(field) || (field.removable ?? true)
