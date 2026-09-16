import type { TFunction } from "i18next"
import type { AttendeeCategoryForm } from "@/types/Attendee"

function humanizeKey(key: string): string {
  const value = key.replace(/_/g, " ").trim()
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : key
}

export function resolveRecipientRoleLabel(
  category: AttendeeCategoryForm,
  t: TFunction,
): string {
  const meta = category.display_meta as Record<string, unknown> | undefined
  const metaLabel = meta?.label
  if (typeof metaLabel === "string" && metaLabel.trim() !== "") {
    return metaLabel
  }
  return t(`checkout.recipient_assignment.roles.${category.key}`, {
    defaultValue: humanizeKey(category.key),
  })
}

export function resolveRecipientFieldLabel(
  name: string,
  label: string | undefined,
  t: TFunction,
): string {
  if (label?.trim()) return label
  return t(`checkout.recipient_assignment.fields.${name}`, {
    defaultValue: humanizeKey(name),
  })
}
