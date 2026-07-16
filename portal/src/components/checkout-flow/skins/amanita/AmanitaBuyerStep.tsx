"use client"

/**
 * Amanita skin — "Tus Datos" buyer step.
 *
 * Renders the popup's buyer form as declared in the form builder — the same
 * `buyerFormSchema` the default checkout reads — wearing Amanita's chrome.
 *
 * It used to hardcode email/first_name/last_name plus a bespoke WhatsApp
 * field and ignore the schema completely. That silently dropped any field an
 * organizer configured, and a REQUIRED one was worse than invisible: the
 * backend still validated it (payment/crud.py `_validate_open_ticketing_form_data`)
 * so the purchase died on a 422 with no input on screen to fix. Reading the
 * schema is what makes the skin a skin rather than a fork of the form.
 *
 * A skin owns presentation, not the field list: this file decides how a
 * `phone` looks in Amanita, never whether a phone is collected.
 */
import { type CSSProperties, useState } from "react"
import { useTranslation } from "react-i18next"
import { getCheckoutSchemaSections } from "@/app/checkout/types"
import type { TicketingStepPublic } from "@/client"
import { useCheckout } from "@/providers/checkoutProvider"
import type { FormFieldSchema } from "@/types/form-schema"
import { SectionShell, shellCopy } from "./SectionShell"

/** Curated WhatsApp country list. Rendered as TEXT ("AR +54") — no flag
 *  emojis (they don't render on Chrome/Windows, a known repo gotcha). */
export const WA_COUNTRIES = [
  { code: "AR", dial: "54" },
  { code: "UY", dial: "598" },
  { code: "CL", dial: "56" },
  { code: "BR", dial: "55" },
  { code: "PY", dial: "595" },
  { code: "BO", dial: "591" },
  { code: "PE", dial: "51" },
  { code: "CO", dial: "57" },
  { code: "MX", dial: "52" },
  { code: "US", dial: "1" },
  { code: "ES", dial: "34" },
  { code: "DE", dial: "49" },
  { code: "FR", dial: "33" },
  { code: "GB", dial: "44" },
  { code: "IT", dial: "39" },
  { code: "IL", dial: "972" },
  { code: "PT", dial: "351" },
  { code: "NL", dial: "31" },
] as const

const DEFAULT_WA_COUNTRY = "AR"

const CREAM_CARD_STYLE: CSSProperties = {
  border: "1px solid rgba(193,170,136,0.4)",
  boxShadow: "0 18px 48px rgba(1,15,22,0.5)",
}

const FIELD_INPUT_STYLE = (hasError: boolean): CSSProperties => ({
  backgroundColor: "#faf6ef",
  borderColor: hasError ? "#b3271e" : "rgba(4,34,49,0.18)",
})

const LABEL_CLASS =
  "font-condensed text-xs font-medium uppercase tracking-[0.16em] text-primary"
const CONTROL_CLASS =
  "mt-1.5 w-full rounded-xl border px-4 py-3 text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent"

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Example text the mockup shows in the three structural fields. A skin may
 *  suggest how to fill a field it knows by name, but never overrides copy the
 *  organizer authored — a configured `placeholder` always wins. */
const PLACEHOLDER_KEY_BY_FIELD: Record<string, string> = {
  email: "checkout.amanita.buyer_placeholder_email",
  first_name: "checkout.amanita.buyer_placeholder_first_name",
  last_name: "checkout.amanita.buyer_placeholder_last_name",
}

/** Split an E.164 number into a supported country + national digits.
 *  Longest-dial-first so "+598…" reads as UY, not US ("+1") by prefix luck. */
function splitE164(value: string): { country: string; national: string } {
  if (value.startsWith("+")) {
    const digits = value.slice(1)
    const match = [...WA_COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => digits.startsWith(c.dial))
    if (match) {
      return { country: match.code, national: digits.slice(match.dial.length) }
    }
  }
  return { country: DEFAULT_WA_COUNTRY, national: value.replace(/^\+/, "") }
}

function dialFor(code: string): string {
  return WA_COUNTRIES.find((c) => c.code === code)?.dial ?? "54"
}

/** getCheckoutSchemaSections parks fields that carry no section_id — the
 *  structural email/first_name/last_name — in this synthetic group and titles
 *  it with a hardcoded "Personal information". That title is a portal
 *  artifact, not the organizer's, and printing it next to their own section
 *  showed the heading twice. Only real sections get to name themselves. */
const SYNTHETIC_SECTION_ID = "_unsectioned_base"

type FieldEntry = { name: string; field: FormFieldSchema }

/** Group a section's fields into rows. first_name + last_name share one, the
 *  way the mockup pairs them; everything else takes a full row. */
function toRows(fields: FieldEntry[]): FieldEntry[][] {
  const rows: FieldEntry[][] = []
  for (let i = 0; i < fields.length; i++) {
    const current = fields[i]
    const next = fields[i + 1]
    if (current.name === "first_name" && next?.name === "last_name") {
      rows.push([current, next])
      i++
      continue
    }
    rows.push([current])
  }
  return rows
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-1.5 text-xs font-semibold" style={{ color: "#b3271e" }}>
      {message}
    </p>
  )
}

/** One schema field in Amanita chrome. Presentation only — which fields
 *  exist, their labels and whether they're required all come from config. */
function AmanitaField({
  name,
  field,
  value,
  error,
  onChange,
}: {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
}) {
  const { t } = useTranslation()
  const id = `ck-${name}`
  const label = field.label
  const hasError = !!error
  const placeholderKey = PLACEHOLDER_KEY_BY_FIELD[name]
  const placeholder =
    field.placeholder ?? (placeholderKey ? t(placeholderKey) : undefined)

  if (field.type === "phone") {
    const { country, national } = splitE164(asString(value))
    return (
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <div className="mt-1.5 flex gap-2">
          <select
            aria-label={t("checkout.amanita.whatsapp_country_aria")}
            autoComplete="tel-country-code"
            value={country}
            onChange={(e) =>
              onChange(name, `+${dialFor(e.target.value)}${national}`)
            }
            className="shrink-0 rounded-xl border px-3 py-3 text-sm font-medium text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent"
            style={{
              backgroundColor: "#faf6ef",
              borderColor: "rgba(4,34,49,0.18)",
            }}
          >
            {WA_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} +{c.dial}
              </option>
            ))}
          </select>
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder={placeholder}
            value={national}
            onChange={(e) =>
              onChange(name, `+${dialFor(country)}${e.target.value}`)
            }
            aria-invalid={hasError || undefined}
            className="w-full min-w-0 rounded-xl border px-4 py-3 text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent"
            style={FIELD_INPUT_STYLE(hasError)}
          />
        </div>
        {error && <FieldError message={error} />}
      </div>
    )
  }

  if (field.type === "select") {
    return (
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <select
          id={id}
          value={asString(value)}
          onChange={(e) => onChange(name, e.target.value)}
          aria-invalid={hasError || undefined}
          className={CONTROL_CLASS}
          style={FIELD_INPUT_STYLE(hasError)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {error && <FieldError message={error} />}
      </div>
    )
  }

  if (field.type === "textarea") {
    return (
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <textarea
          id={id}
          rows={3}
          value={asString(value)}
          onChange={(e) => onChange(name, e.target.value)}
          aria-invalid={hasError || undefined}
          className={CONTROL_CLASS}
          style={FIELD_INPUT_STYLE(hasError)}
        />
        {error && <FieldError message={error} />}
      </div>
    )
  }

  if (field.type === "boolean") {
    return (
      <div>
        <label htmlFor={id} className="flex items-center gap-2.5 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(name, e.target.checked)}
            className="h-4 w-4 rounded border-primary/40"
          />
          <span className="text-deep">{label}</span>
        </label>
        {error && <FieldError message={error} />}
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type={
          field.type === "email"
            ? "email"
            : field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : field.type === "url"
                  ? "url"
                  : "text"
        }
        inputMode={field.type === "number" ? "numeric" : undefined}
        autoComplete={
          name === "email"
            ? "email"
            : name === "first_name"
              ? "given-name"
              : name === "last_name"
                ? "family-name"
                : undefined
        }
        placeholder={placeholder}
        value={asString(value)}
        onChange={(e) => onChange(name, e.target.value)}
        aria-invalid={hasError || undefined}
        className={CONTROL_CLASS}
        style={FIELD_INPUT_STYLE(hasError)}
      />
      {error && <FieldError message={error} />}
    </div>
  )
}

export default function AmanitaBuyerStep({
  stepConfig,
}: {
  /** The organizer's buyer step, when one is configured — it names this
   *  section. Optional: a popup with no buyer step row still collects the
   *  schema's fields, so the skin's own copy stands in. */
  stepConfig?: TicketingStepPublic | null
}) {
  const { t } = useTranslation()
  const {
    buyerValues,
    buyerErrors,
    setBuyerField,
    forcedBuyerFieldsTouched,
    buyerFormSchema,
    getBuyerInvalidFields,
  } = useCheckout()

  const [localTouched, setLocalTouched] = useState<Set<string>>(() => new Set())
  const markTouched = (name: string) =>
    setLocalTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)))
  // Union the provider's forced set in at read time, matching
  // OpenTicketingBuyerForm. Blur alone isn't enough: the funnel bounces a
  // shopper here for fields they never focused — precisely the ones left
  // empty — so on a purely local `touched` the step would open looking
  // pristine and the bounce would read as a dead button.
  const isTouched = (name: string) =>
    localTouched.has(name) || forcedBuyerFieldsTouched.has(name)

  const sections = buyerFormSchema
    ? getCheckoutSchemaSections(buyerFormSchema, { includeAllSections: true })
    : []
  // Same Zod-derived set the funnel gates on, so what the step paints red and
  // what blocks Pay can never disagree.
  const invalidFields = new Set(getBuyerInvalidFields())

  // With a single organizer section — the normal open-ticketing shape — its
  // heading leads the whole card, so the structural fields sitting in the
  // synthetic group read as part of it instead of as an untitled orphan
  // block. Several sections keep their headings in place, where they still
  // tell the shopper what changed.
  const realSections = sections.filter((s) => s.id !== SYNTHETIC_SECTION_ID)
  const hoistedTitle =
    realSections.length === 1 ? realSections[0].title : undefined

  const copy = shellCopy(stepConfig, {
    kicker: t("checkout.amanita.buyer_kicker"),
    title: t("checkout.amanita.buyer_title"),
    intro: t("checkout.amanita.buyer_intro"),
  })

  return (
    <SectionShell
      gem="flourish"
      kicker={copy.kicker}
      title={copy.title}
      intro={copy.intro}
    >
      <div
        className="rounded-2xl bg-cream p-6 text-left md:p-8"
        style={CREAM_CARD_STYLE}
      >
        <div className="flex items-start gap-2.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <p className="text-xs leading-relaxed" style={{ color: "#4a6670" }}>
            {t("checkout.amanita.buyer_privacy")}
          </p>
        </div>

        {hoistedTitle ? (
          <h3 className="mt-6 font-condensed text-sm font-medium uppercase tracking-[0.14em] text-primary">
            {hoistedTitle}
          </h3>
        ) : null}

        {sections.map((section) => (
          <div key={section.id} className="mt-6 flex flex-col gap-5">
            {!hoistedTitle &&
            section.id !== SYNTHETIC_SECTION_ID &&
            section.title ? (
              <h3 className="font-condensed text-sm font-medium uppercase tracking-[0.14em] text-primary">
                {section.title}
              </h3>
            ) : null}
            {toRows(section.fields).map((row) => {
              const renderField = ({ name, field }: FieldEntry) => {
                const error =
                  buyerErrors[name] ??
                  (isTouched(name) && invalidFields.has(name) && field.required
                    ? t("checkout.field_required", {
                        defaultValue: "Este campo es obligatorio",
                      })
                    : undefined)
                return (
                  <div key={name} onBlurCapture={() => markTouched(name)}>
                    <AmanitaField
                      name={name}
                      field={field}
                      value={buyerValues[name]}
                      error={error}
                      onChange={setBuyerField}
                    />
                  </div>
                )
              }

              if (row.length === 2) {
                return (
                  <div
                    key={row[0].name}
                    data-testid="ck-name-row"
                    className="grid gap-5 md:grid-cols-2"
                  >
                    {row.map(renderField)}
                  </div>
                )
              }
              return renderField(row[0])
            })}
          </div>
        ))}
      </div>
    </SectionShell>
  )
}
