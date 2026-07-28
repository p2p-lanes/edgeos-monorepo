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

// Email input with blur-based validation. Paints amber border + helper
// message once the field is "touched" AND its value either fails the
// loose regex or has a parent Zod error. Forced-touched comes through
// the provider when the buyer clicks Pay with incomplete data.
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
            // stays reserved for genuine server/payment errors.
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

export function OpenTicketingBuyerForm({
  schema,
  values,
  errors,
  onChange,
}: OpenTicketingBuyerFormProps) {
  const { t } = useTranslation()
  const { getBuyerInvalidFields, forcedBuyerFieldsTouched } = useCheckout()
  // Open ticketing: the popup's buyer form is the whole form, so opt out
  // of the application-flow mini-form reduction. Without this a popup with
  // no BaseFieldConfigs renders none of the organizer's fields at all.
  const sections = getCheckoutSchemaSections(schema, {
    includeAllSections: true,
  })
  const genderField = schema.base_fields.gender
  const displayGender = getDisplayGender(values, schema)
  const genderSpecifyValue = getGenderSpecifyValue(values)

  // Per-field local touched state. Forced fields (from the provider) are
  // unioned in at read time so the user can't escape the highlight by
  // refusing to focus a field.
  const [localTouched, setLocalTouched] = useState<Set<string>>(() => new Set())
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

  // Set of fields that currently fail the Zod schema. We surface these
  // inline on touched fields so the user sees the same gating the
  // funnel uses upstream.
  const invalidFieldSet = useMemo(
    () => new Set(getBuyerInvalidFields()),
    [getBuyerInvalidFields],
  )

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-sm border border-border"
      style={stepCardSurfaceStyle()}
    >
      {/* Hero band: warm accent surface introducing the buyer step.
          Falls back to currentColor when the popup didn't configure an
          accent so all popups still render coherently. */}
      <div
        className="px-6 py-5 flex items-start gap-3"
        style={{
          background:
            "color-mix(in srgb, var(--accent, currentColor) 12%, transparent)",
        }}
      >
        <div
          className="rounded-xl p-2 shrink-0"
          style={{
            background:
              "color-mix(in srgb, var(--accent, currentColor) 20%, transparent)",
          }}
        >
          <Sparkles className="w-5 h-5 text-[color:var(--accent,currentColor)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            {t("checkout.buyer_hero_title", {
              defaultValue: "¡Estás a un paso!",
            })}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("checkout.buyer_hero_subtitle", {
              defaultValue:
                "Necesitamos un par de datos para reservar tu lugar.",
            })}
          </p>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {t("checkout.buyer_hero_trust", {
              defaultValue:
                "Tu privacidad nos es importante. No compartimos tus datos con terceros.",
            })}
          </p>
        </div>
      </div>

      <section className="space-y-6 px-6 py-6">
        {sections.map((section) => (
          <section key={section.id} className="space-y-4">
            {/* The whole buyer step already announces itself with its own
                step title, so the personal-info sections stay unlabelled —
                the synthetic base group and any single configured section
                both read as one block instead of a redundant heading. */}
            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map(({ name, field }) => {
                if (name === "email") {
                  return (
                    <EmailField
                      key={name}
                      label={field.label}
                      helpText={field.help_text ?? undefined}
                      required={field.required}
                      value={String(values.email ?? "")}
                      onChange={(next) => onChange("email", next)}
                      parentError={errors.email}
                      touched={isTouched("email")}
                      onBlur={() => markTouched("email")}
                    />
                  )
                }

                if (name === "gender" && genderField) {
                  return (
                    <div key={name} className="space-y-4 md:col-span-2">
                      <SelectForm
                        label={genderField.label}
                        id="gender"
                        value={displayGender}
                        onChange={(value) => {
                          onChange("gender", value)
                          markTouched("gender")
                        }}
                        error={
                          errors.gender ??
                          (isTouched("gender") &&
                          invalidFieldSet.has("gender") &&
                          !displayGender
                            ? t("checkout.field_required", {
                                defaultValue: "Este campo es obligatorio",
                              })
                            : undefined)
                        }
                        errorTone="warning"
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
                          onChange={(value) =>
                            onChange("gender_specify", value)
                          }
                          error={errors.gender_specify}
                          errorTone="warning"
                          isRequired
                          placeholder={t("form.gender_specify_placeholder")}
                        />
                      ) : null}
                    </div>
                  )
                }

                // Compute an inline error for regular fields when the
                // Zod schema flags them AND the user has either touched
                // them or the funnel has forcefully revealed errors. Falls
                // back to the parent's `errors[name]` (server-side / async
                // validation), which always wins.
                const touched = isTouched(name)
                const isInvalid = invalidFieldSet.has(name)
                const inlineError =
                  errors[name] ??
                  (touched && isInvalid && field.required
                    ? t("checkout.field_required", {
                        defaultValue: "Este campo es obligatorio",
                      })
                    : undefined)

                return (
                  <div
                    key={name}
                    onBlurCapture={() => markTouched(name)}
                    className={
                      field.type === "textarea" || field.type === "multiselect"
                        ? "md:col-span-2"
                        : ""
                    }
                  >
                    <DynamicField
                      name={name}
                      field={field}
                      value={values[name]}
                      error={inlineError}
                      errorTone="warning"
                      onChange={onChange}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </section>
    </div>
  )
}
