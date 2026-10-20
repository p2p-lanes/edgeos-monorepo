import type { PaymentPublic } from "@/client"
import { PaymentFormResponseHistory } from "./PaymentFormResponseHistory"

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function label(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function formatAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not answered"
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) {
    return value.length ? value.map(formatAnswer).join(", ") : "Not answered"
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

/** Labels come from purchase time; only audited buyer edits can change values. */
export function paymentFormSections(snapshot: unknown) {
  const sections = record(snapshot)?.sections
  if (!Array.isArray(sections)) return []

  return sections
    .flatMap((value, index) => {
      const section = record(value)
      if (!section || !Array.isArray(section.fields)) return []
      const fields = section.fields.flatMap((value) => {
        const field = record(value)
        if (!field) return []
        const fieldLabel = label(field.field_label) ?? label(field.field_name)
        if (!fieldLabel) return []
        return [{ label: fieldLabel, value: formatAnswer(field.value) }]
      })
      if (!fields.length) return []
      return [
        {
          label: label(section.section_label) ?? "Form details",
          order:
            typeof section.section_order === "number"
              ? section.section_order
              : index,
          fields,
        },
      ]
    })
    .sort((a, b) => a.order - b.order)
}

export function PaymentFormResponses({
  snapshot,
  paymentId,
}: {
  paymentId?: string
  snapshot: PaymentPublic["buyer_snapshot"]
}) {
  const sections = paymentFormSections(snapshot)
  if (!sections.length) return null

  return (
    <section aria-label="Form responses" className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Form responses</h3>
        {paymentId && <PaymentFormResponseHistory paymentId={paymentId} />}
      </div>
      <div className="mt-4 space-y-4">
        {sections.map((section, sectionIndex) => (
          <section key={`${section.label}-${sectionIndex}`}>
            <h4 className="text-sm font-medium">{section.label}</h4>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              {section.fields.map((field, fieldIndex) => (
                <div key={`${field.label}-${fieldIndex}`} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {field.label}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  )
}
