import { SchemaField } from "@edgeos/shared-form-ui"

import { cn } from "@/lib/utils"
import {
  type GuestField,
  type GuestFormValue,
  guestFieldsOf,
  toSchemaField,
} from "./guestForm"

/**
 * What the buyer will see.
 *
 * Rendered with `SchemaField`, the same component the checkout uses, so the
 * preview cannot drift from the thing it previews. Read-only: this is a
 * picture of the form, not the form.
 */
export function GuestFormPreview({ form }: { form: GuestFormValue }) {
  const guestFields = guestFieldsOf(form)

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Preview
      </p>

      <PreviewSection
        heading="Lead guest"
        subheading="Asked once per room"
        fields={form.booker.fields}
      />

      {guestFields.length > 0 ? (
        <PreviewSection
          heading="Guest 2"
          subheading={
            form.guests.mode === "same_as_booker"
              ? "Repeated for every additional guest, same questions"
              : "Repeated for every additional guest"
          }
          fields={guestFields}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Additional guests are asked nothing beyond their name.
        </p>
      )}
    </div>
  )
}

function PreviewSection({
  heading,
  subheading,
  fields,
}: {
  heading: string
  subheading: string
  fields: GuestField[]
}) {
  if (fields.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{heading}</p>
        <p className="text-xs text-muted-foreground">No questions yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{heading}</p>
        <p className="text-xs text-muted-foreground">{subheading}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.key}
            className={cn(field.width !== "half" && "sm:col-span-2")}
          >
            <SchemaField
              name={`preview-${field.key}`}
              field={toSchemaField(field)}
              value=""
              readOnly
              onChange={() => {}}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
