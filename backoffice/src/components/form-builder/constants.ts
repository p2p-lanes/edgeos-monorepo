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

export const slugify = (...parts: string[]): string =>
  parts
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_{2,}/g, "_")
