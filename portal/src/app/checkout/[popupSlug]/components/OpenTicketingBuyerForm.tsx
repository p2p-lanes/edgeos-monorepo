"use client"

import {
  Input,
  InputForm,
  LabelRequired,
  SelectForm,
} from "@edgeos/shared-form-ui"
import { AlertCircle, ShieldCheck, Sparkles } from "lucide-react"
import { useCallback, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import { stepCardSurfaceStyle } from "@/lib/stepCardSurface"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { getCheckoutSchemaSections } from "../../types"

// Loose email shape check used for the on-blur visual cue only. The
// authoritative validator is still the Zod schema on the parent — this
// just decides whether to paint the "doesn't look like an email" warning
// the moment the user moves focus away (before Zod errors arrive).
const EMAIL_LOOSE_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

interface OpenTicketingBuyerFormProps {
  schema: ApplicationFormSchema
  values: Record<string, unknown>
  errors: Record<string, string>
  onChange: (fieldName: string, value: unknown) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDisplayGender(
  values: Record<string, unknown>,
  schema: ApplicationFormSchema,
) {
  const gender = values.gender
  if (gender === "Specify") return "Specify"
  if (typeof gender !== "string") return ""

  const options = schema.base_fields.gender?.options ?? []
  if (gender && !options.includes(gender)) return "Specify"
  return gender
}

function getGenderSpecifyValue(values: Record<string, unknown>) {
  const specifiedGender = values.gender_specify
  if (typeof specifiedGender === "string" && specifiedGender) {
    return specifiedGender
  }

  const gender = values.gender
  if (typeof gender !== "string") return ""
  if (gender.startsWith("SYO - ")) return gender.slice("SYO - ".length)
  return ""
}

// Email field with blur validation visual cue. Renders a red border,
// AlertCircle icon, and helper message once the field is "touched"
// AND its value either fails the loose email regex or has a parent
// Zod-level error.
function EmailField({
  label,
  helpText,
  required,
  value,
  onChange,
  parentError,
  touched,
  onBlur,
}: {
  label: string
  helpText?: string
  required?: boolean
  value: string
  onChange: (next: string) => void
  parentError?: string
  touched: boolean
  onBlur: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const isInvalidFormat =
    touched && value.trim() !== "" && !EMAIL_LOOSE_RE.test(value.trim())
  // Blank required fields after the user has touched (or been forced to
  // show errors) should also flash the "this is required" red border so
  // the buyer doesn't have to chase the error to a tiny inline message.
  const isBlankRequired = touched && required && value.trim() === ""
  const errorMessage =
    parentError ??
    (isInvalidFormat
      ? t("checkout.email_invalid", {
          defaultValue: "Esto no parece un email válido",
        })
      : isBlankRequired
        ? t("checkout.field_required", {
            defaultValue: "Este campo es obligatorio",
          })
        : undefined)
  const showError = !!errorMessage

  return (
    <div className="space-y-2 md:col-span-2">
      <LabelRequired isRequired={required}>{label}</LabelRequired>
      {helpText ? (
        <p className="text-sm text-muted-foreground">{helpText}</p>
      ) : null}
      <div className="relative">
        <Input
          id={`email-${id}`}
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={cn(
            "w-full transition-all duration-200",
            // Amber (not red) for "needs your attention" — matches the
            // nav's visited-incomplete tint and the shared toast. Red
            // is reserved for genuine errors (server/payment failures).
            showError &&
              "border-amber-500 ring-2 ring-amber-500/20 focus-visible:ring-amber-500/30",
          )}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? `email-err-${id}` : undefined}
        />
        {showError && (
          <AlertCircle
            aria-hidden
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-600"
          />
        )}
      </div>
      {showError && (
        <p
          id={`email-err-${id}`}
          className="text-sm text-amber-700 flex items-center gap-1.5"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}

// Generic non-email, non-gender field. Wraps DynamicField with a blur
// listener so we can mark it touched, and merges any Zod field-level
// error with the parent's error stream.
function GenericField({
  name,
  field,
  value,
  errorOverride,
  parentError,
  onChange,
  touched,
  onBlur,
}: {
  name: string
  field: ApplicationFormSchema["base_fields"][string]
  value: unknown
  errorOverride?: string
  parentError?: string
  onChange: (fieldName: string, value: unknown) => void
  touched: boolean
  onBlur: () => void
}) {
  const wide = field.type === "textarea" || field.type === "multiselect"
  // Surface the inline error only after the field has been touched
  // (blurred at least once) OR the parent already has a real-error
  // string. Same blur-driven discipline as EmailField — keeps typing
  // calm and reveals issues only when the user pauses.
  const inlineError = parentError ?? (touched ? errorOverride : undefined)
  return (
    <div
      className={wide ? "md:col-span-2" : ""}
      onBlur={(e) => {
        // Mark as touched when focus leaves any element inside (input,
        // select, radio button). Use `onBlur` (not `onBlurCapture`)
        // with `currentTarget.contains(relatedTarget)` to avoid firing
        // for focus shuffles within the same field's UI.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onBlur()
        }
      }}
    >
      <DynamicField
        name={name}
        field={field}
        value={value}
        error={inlineError}
        onChange={onChange}
      />
    </div>
  )
}

function GenderField({
  schema,
  values,
  errors,
  onChange,
  zodErrorByField,
  isTouched,
  markTouched,
}: OpenTicketingBuyerFormProps & {
  zodErrorByField: Record<string, string>
  isTouched: (name: string) => boolean
  markTouched: (name: string) => void
}) {
  const { t } = useTranslation()
  const genderField = schema.base_fields.gender
  if (!genderField) return null
  const displayGender = getDisplayGender(values, schema)
  const genderSpecifyValue = getGenderSpecifyValue(values)
  const genderInlineError =
    errors.gender ?? (isTouched("gender") ? zodErrorByField.gender : undefined)
  const specifyInlineError =
    errors.gender_specify ??
    (isTouched("gender_specify")
      ? zodErrorByField.gender_specify
      : undefined)
  return (
    <div
      className="space-y-4 md:col-span-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          markTouched("gender")
          markTouched("gender_specify")
        }
      }}
    >
      <SelectForm
        label={genderField.label}
        id="gender"
        value={displayGender}
        onChange={(value) => onChange("gender", value)}
        error={genderInlineError}
        isRequired={genderField.required}
        options={(genderField.options ?? []).map((option) => ({
          value: option,
          label: option,
        }))}
      />
      {displayGender === "Specify" ? (
        <InputForm
          label={t("form.gender_specify")}
          id="gender_specify"
          value={genderSpecifyValue}
          onChange={(value) => onChange("gender_specify", value)}
          error={specifyInlineError}
          isRequired
          placeholder={t("form.gender_specify_placeholder")}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card-hero presentation — accent-filled hero band on top, fields below.
// ---------------------------------------------------------------------------

export function OpenTicketingBuyerForm({
  schema,
  values,
  errors,
  onChange,
}: OpenTicketingBuyerFormProps) {
  const { t } = useTranslation()
  const sections = getCheckoutSchemaSections(schema)
  const { forcedBuyerFieldsTouched } = useCheckout()

  // Local "touched" set, merged with the provider-level forced set so
  // pressing Continuar / Pagar with errors can reveal them all at once.
  const [localTouched, setLocalTouched] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const isTouched = useCallback(
    (name: string) =>
      localTouched.has(name) || forcedBuyerFieldsTouched.has(name),
    [localTouched, forcedBuyerFieldsTouched],
  )
  const markTouched = useCallback((name: string) => {
    setLocalTouched((prev) => {
      if (prev.has(name)) return prev
      const next = new Set(prev)
      next.add(name)
      return next
    })
  }, [])

  // Default "this field is required" copy used to translate Zod's raw
  // "Invalid input: expected string, received undefined" message into
  // something the buyer can actually read.
  const requiredCopy = t("checkout.field_required", {
    defaultValue: "Este campo es obligatorio",
  })

  // Zod schema is the source of truth. Compute the field → message map
  // once per value change so individual fields don't each run a full
  // safeParse. Zod's raw "expected string, received undefined" issues
  // are rewritten to the localized "required" message — the rest of the
  // issues (regex mismatch, etc.) come through as-is.
  const zodErrorByField = useMemo<Record<string, string>>(() => {
    const result = buildFormZodSchema(schema, false).safeParse(values)
    if (result.success) return {}
    const map: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const name =
        Array.isArray(issue.path) && issue.path.length > 0
          ? String(issue.path[0])
          : null
      if (!name || map[name]) continue
      const looksRequired =
        issue.code === "invalid_type" ||
        (issue.code === "too_small" && issue.minimum === 1) ||
        /received\s+(undefined|null)/i.test(issue.message)
      map[name] = looksRequired ? requiredCopy : issue.message
    }
    return map
  }, [schema, values, requiredCopy])

  return (
    <section
      className="rounded-2xl border shadow-sm overflow-hidden"
      style={stepCardSurfaceStyle()}
    >
      <header className="relative px-6 py-7 bg-[color:var(--accent,theme(colors.foreground))] text-[color:var(--primary,theme(colors.background))]">
        <div className="flex items-start gap-4">
          <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-full bg-[color:var(--primary,theme(colors.foreground))]/15 backdrop-blur-sm">
            <Sparkles className="w-6 h-6" />
          </span>
          <div className="space-y-1">
            <h3 className="text-xl font-bold leading-tight">
              {t("checkout.buyer_hero_title", {
                defaultValue: "¡Estás a un paso!",
              })}
            </h3>
            <p className="text-sm opacity-90">
              {t("checkout.buyer_hero_subtitle", {
                defaultValue:
                  "Necesitamos un par de datos para reservar tu lugar.",
              })}
            </p>
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium opacity-90">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>
            {t("checkout.buyer_hero_trust", {
              defaultValue:
                "Tu privacidad nos es importante. No compartimos tus datos con terceros.",
            })}
          </span>
        </div>
      </header>

      <div className="px-6 py-6 space-y-6">
        {sections.map((section) => (
          <section key={section.id} className="space-y-4">
            {sections.length > 1 ? (
              <div>
                <h4 className="text-sm font-semibold">{section.title}</h4>
                {section.subtitle ? (
                  <p className="text-sm text-muted-foreground">
                    {section.subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map(({ name, field }) => {
                if (name === "email") {
                  return (
                    <EmailField
                      key={name}
                      label={field.label}
                      helpText={field.help_text}
                      required={field.required}
                      value={String(values.email ?? "")}
                      onChange={(v) => onChange("email", v)}
                      parentError={errors.email}
                      touched={isTouched("email")}
                      onBlur={() => markTouched("email")}
                    />
                  )
                }
                if (name === "gender") {
                  return (
                    <GenderField
                      key={name}
                      schema={schema}
                      values={values}
                      errors={errors}
                      onChange={onChange}
                      zodErrorByField={zodErrorByField}
                      isTouched={isTouched}
                      markTouched={markTouched}
                    />
                  )
                }
                return (
                  <GenericField
                    key={name}
                    name={name}
                    field={field}
                    value={values[name]}
                    parentError={errors[name]}
                    errorOverride={zodErrorByField[name]}
                    onChange={onChange}
                    touched={isTouched(name)}
                    onBlur={() => markTouched(name)}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
