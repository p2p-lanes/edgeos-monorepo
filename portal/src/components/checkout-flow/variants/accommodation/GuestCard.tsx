"use client"

import { Check, ChevronDown, Copy } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { checkField, type GuestFormField } from "@/lib/accommodationForm"
import { cn } from "@/lib/utils"
import type { CheckoutGuest } from "@/types/checkout"

interface GuestCardProps {
  index: number
  guest: CheckoutGuest
  fields: GuestFormField[]
  requireName: boolean
  /** Open on mount. The lead guest is; the others are not. */
  defaultOpen: boolean
  /** Keys the lead guest also answers, so "same as lead guest" has meaning. */
  copyableKeys: string[]
  /** Shown collapsed in place of a typed name. The lead occupant's name is
   *  the buyer's, and it is stated on the contact row rather than asked for
   *  here, so without this their card would read "Not filled in yet" about
   *  something that is in fact known. */
  summary?: string
  onName: (name: string) => void
  onAnswer: (key: string, value: unknown) => void
  onCopyFromLead: () => void
}

/**
 * One occupant, collapsed until it is their turn.
 *
 * With four guests and six questions each, a flat list is twenty-four inputs
 * and nobody reaches the end of it. Collapsed rows carry their own summary so
 * the state of the party is legible without opening anything.
 *
 * Errors appear after the field is left, not while it is being typed in:
 * telling someone their email is malformed at the third character is telling
 * them off for not having finished.
 */
export function GuestCard({
  index,
  guest,
  fields,
  requireName,
  defaultOpen,
  copyableKeys,
  summary,
  onName,
  onAnswer,
  onCopyFromLead,
}: GuestCardProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const nameMissing = requireName && !guest.name.trim()
  const missing =
    (nameMissing ? 1 : 0) +
    fields.filter((field) => checkField(field, guest.answers)).length
  const label =
    index === 0
      ? t("checkout.accommodation.form.lead_guest")
      : t("checkout.accommodation.form.guest_number", { number: index + 1 })

  return (
    <div className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{label}</span>
          {!open && (
            <span className="truncate text-xs text-muted-foreground">
              {guest.name.trim() ||
                summary ||
                t("checkout.accommodation.form.not_filled_in")}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {missing === 0 ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" />
              {t("checkout.accommodation.form.complete")}
            </span>
          ) : (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              {t("checkout.accommodation.form.missing_count", {
                count: missing,
              })}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t p-3">
          {index > 0 && copyableKeys.length > 0 && (
            <button
              type="button"
              onClick={onCopyFromLead}
              className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Copy className="h-3.5 w-3.5" />
              {t("checkout.accommodation.form.same_as_lead")}
            </button>
          )}

          {requireName && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`guest-name-${index}`}>
                {t("checkout.accommodation.form.name")}
              </Label>
              <Input
                id={`guest-name-${index}`}
                value={guest.name}
                aria-invalid={nameMissing && touched.name === true}
                onChange={(event) => onName(event.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                placeholder={t(
                  "checkout.accommodation.guest_name_placeholder",
                  { number: index + 1 },
                )}
              />
            </div>
          )}

          {fields.map((field) => {
            const error = checkField(field, guest.answers)
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: a blur listener is not an interaction; it exists to know when the buyer has left the field, so the error appears then rather than at the third keystroke
              <div
                key={field.key}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, [field.key]: true }))
                }
              >
                <DynamicField
                  name={field.key}
                  field={toSchema(field)}
                  value={guest.answers[field.key] ?? ""}
                  error={touched[field.key] && error ? error : undefined}
                  onChange={(_name, value) => onAnswer(field.key, value)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The shape the shared renderer takes. Both come from the same catalog, so
 *  this is a rename rather than a translation. */
export function toSchema(field: GuestFormField) {
  return {
    type: (field.type ?? "text") as "text",
    label: field.label,
    required: field.required ?? false,
    options: field.options?.length ? field.options : undefined,
    placeholder: field.placeholder ?? undefined,
    help_text: field.help_text ?? undefined,
    config: field.config,
  }
}
