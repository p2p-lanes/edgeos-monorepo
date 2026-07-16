import { useQuery } from "@tanstack/react-query"

import {
  ApplicationsService,
  FormFieldsService,
  type HumanPublic,
} from "@/client"

/**
 * "Declared" panel — the answers a person typed into the application form,
 * shown read-only and tidied at display time. We deliberately do NOT copy this
 * into the curated `enriched_profile`: it is user-owned and user-editable, so
 * the only honest place to surface it is its source, rendered against the live
 * form schema (label, type, order, section) rather than the raw slug/value.
 */

interface FieldSchema {
  type: string
  label: string
  position?: number
  section_id?: string | null
  options?: string[]
}
interface SectionSchema {
  id: string
  label: string
  order: number
}
interface AppSchema {
  custom_fields: Record<string, FieldSchema>
  sections: SectionSchema[]
}

function fieldLabel(schema: AppSchema | undefined, key: string): string {
  const label = schema?.custom_fields?.[key]?.label
  if (label) return label
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function formatValue(
  schema: AppSchema | undefined,
  key: string,
  value: unknown,
): string {
  if (value === null || value === undefined || value === "") return "—"
  const type = schema?.custom_fields?.[key]?.type
  if (type === "boolean") return value ? "Yes" : "No"
  if (type === "multiselect" && Array.isArray(value)) return value.join(", ")
  if (type === "date" && typeof value === "string") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
  }
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Skip empty answers and structural/sensitive keys that aren't worth showing. */
function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false
  if (Array.isArray(value) && value.length === 0) return false
  if (typeof value === "object" && !Array.isArray(value)) {
    // signature-like or empty objects — not useful in a read-only summary
    return Object.values(value as Record<string, unknown>).some(Boolean)
  }
  return true
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground break-words">{label}</p>
      <p className="text-sm break-words whitespace-pre-wrap">{value}</p>
    </div>
  )
}

export function DeclaredFieldsCard({ human }: { human: HumanPublic }) {
  // A human row is tenant-scoped, so this is normally 0-1 application; if the
  // person applied to several popups we surface the richest (most-answered) one.
  const { data: appsData, isPending } = useQuery({
    queryKey: ["human-applications", human.id],
    queryFn: () =>
      ApplicationsService.listApplications({ humanId: human.id, limit: 100 }),
  })

  const applications = appsData?.results ?? []
  const application = [...applications].sort(
    (a, b) =>
      Object.keys(b.custom_fields ?? {}).length -
      Object.keys(a.custom_fields ?? {}).length,
  )[0]

  const { data: schema } = useQuery({
    queryKey: ["form-fields-schema", application?.popup_id],
    queryFn: async () =>
      (await FormFieldsService.getApplicationSchema({
        popupId: application!.popup_id,
      })) as unknown as AppSchema,
    enabled: !!application?.popup_id,
  })

  // Structured human attributes the person also declared (live on the human row,
  // editable above) — handy to see alongside the form answers.
  const profileBasics: [string, string | null | undefined][] = [
    ["Telegram", human.telegram],
    ["Residence", human.residence],
    ["Gender", human.gender],
    ["Age", human.age],
  ]
  const basics = profileBasics.filter(([, v]) => v)

  const entries = Object.entries(application?.custom_fields ?? {}).filter(
    ([, v]) => isMeaningful(v),
  )
  entries.sort(([a], [b]) => {
    const pa = schema?.custom_fields?.[a]?.position ?? 999
    const pb = schema?.custom_fields?.[b]?.position ?? 999
    return pa - pb
  })

  // Group by section, preserving section order from the schema.
  const sectionOrder = new Map(
    (schema?.sections ?? []).map((s) => [s.id, s] as const),
  )
  const grouped = new Map<string | null, [string, unknown][]>()
  for (const [key, value] of entries) {
    const sid = schema?.custom_fields?.[key]?.section_id ?? null
    if (!grouped.has(sid)) grouped.set(sid, [])
    grouped.get(sid)!.push([key, value])
  }
  const groups = [...grouped.entries()].sort((a, b) => {
    const oa = a[0] ? (sectionOrder.get(a[0])?.order ?? 999) : 1000
    const ob = b[0] ? (sectionOrder.get(b[0])?.order ?? 999) : 1000
    return oa - ob
  })

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">Loading declared data…</p>
    )
  }

  if (basics.length === 0 && entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This person hasn't declared any profile information yet.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {basics.length > 0 && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {basics.map(([label, value]) => (
            <FieldRow key={label} label={label} value={value as string} />
          ))}
        </div>
      )}

      {groups.map(([sid, fields]) => (
        <div key={sid ?? "_"} className="space-y-3">
          {sid && sectionOrder.get(sid)?.label && (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sectionOrder.get(sid)!.label}
            </p>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map(([key, value]) => (
              <FieldRow
                key={key}
                label={fieldLabel(schema, key)}
                value={formatValue(schema, key, value)}
              />
            ))}
          </div>
        </div>
      ))}

      {applications.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Showing the most complete of {applications.length} applications.
        </p>
      )}
    </div>
  )
}
