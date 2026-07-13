"use client"

/**
 * Amanita skin — "Tus Datos" buyer step (ex "Tu información").
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`InfoSection` +
 * `Field` + `WA_COUNTRIES`). Unlike the mockup (which owns local `BuyerInfo`
 * state), this component is fed by the REAL buyer form state from
 * `useCheckout()` — `buyerValues`/`buyerErrors`/`setBuyerField` — so typing
 * writes straight into the checkout provider that `submitPayment` reads
 * from. OTP email verification is intentionally NOT part of this step: it's
 * not part of open-ticketing today.
 *
 * The WhatsApp field is the one genuinely new field vs. the base
 * OpenCheckoutBuyerStep: it writes `phone` (number) + `phone_country` (ISO
 * code) via `setBuyerField`, same as any other buyer field. Task 6 wired
 * `phone_country` to persist top-level alongside `phone`.
 */
import { type CSSProperties, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useCheckout } from "@/providers/checkoutProvider"
import { SectionShell } from "./SectionShell"

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

const WA_COUNTRY_CODES = new Set<string>(WA_COUNTRIES.map((c) => c.code))
const DEFAULT_WA_COUNTRY = "AR"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\d{6,15}$/

const CREAM_CARD_STYLE: CSSProperties = {
  border: "1px solid rgba(193,170,136,0.4)",
  boxShadow: "0 18px 48px rgba(1,15,22,0.5)",
}

const FIELD_INPUT_STYLE = (hasError: boolean): CSSProperties => ({
  backgroundColor: "#faf6ef",
  borderColor: hasError ? "#b3271e" : "rgba(4,34,49,0.18)",
})

function fieldValue(values: Record<string, unknown>, name: string): string {
  const value = values[name]
  return typeof value === "string" ? value : ""
}

function Field({
  id,
  label,
  type = "text",
  autoComplete,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  type?: string
  autoComplete?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-condensed text-xs font-medium uppercase tracking-[0.16em] text-primary"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className="mt-1.5 w-full rounded-xl border px-4 py-3 text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent"
        style={FIELD_INPUT_STYLE(!!error)}
      />
      {error && (
        <p
          className="mt-1.5 text-xs font-semibold"
          style={{ color: "#b3271e" }}
        >
          {error}
        </p>
      )}
    </div>
  )
}

// Blank/format checks adapted from the mockup's `getInfoErrors`, translated
// via the real checkout.amanita.* validation-message keys. These are only a
// fallback: a `buyerErrors[name]` value from the provider always wins, and
// this local check only surfaces once the field has been touched (blurred)
// so the form doesn't open already covered in red ink.
function useLocalFieldError(
  name: "email" | "first_name" | "last_name" | "phone",
  value: string,
  touched: boolean,
): string | undefined {
  const { t } = useTranslation()
  if (!touched) return undefined
  switch (name) {
    case "email":
      if (!value.trim()) return t("checkout.amanita.email_required")
      if (!EMAIL_RE.test(value.trim()))
        return t("checkout.amanita.email_invalid")
      return undefined
    case "first_name":
      if (!value.trim()) return t("checkout.amanita.first_name_required")
      return undefined
    case "last_name":
      if (!value.trim()) return t("checkout.amanita.last_name_required")
      return undefined
    case "phone":
      if (!value.trim()) return t("checkout.amanita.phone_required")
      if (!PHONE_RE.test(value.replace(/[\s.-]/g, "")))
        return t("checkout.amanita.phone_invalid")
      return undefined
    default:
      return undefined
  }
}

export default function AmanitaBuyerStep() {
  const { t } = useTranslation()
  const { buyerValues, buyerErrors, setBuyerField } = useCheckout()
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const markTouched = (name: string) =>
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)))

  const email = fieldValue(buyerValues, "email")
  const firstName = fieldValue(buyerValues, "first_name")
  const lastName = fieldValue(buyerValues, "last_name")
  const phone = fieldValue(buyerValues, "phone")
  const phoneCountryRaw = fieldValue(buyerValues, "phone_country")
  const phoneCountry = phoneCountryRaw || DEFAULT_WA_COUNTRY

  // Country preselect: reads navigator.language's region (e.g. "es-AR" →
  // "AR") ONLY inside the effect (never during render, to avoid hydration
  // mismatches) and ONLY when phone_country is currently unset AND the
  // region is one of our supported WhatsApp countries.
  useEffect(() => {
    if (phoneCountryRaw) return
    if (typeof navigator === "undefined" || !navigator.language) return
    const region = navigator.language.split("-")[1]?.toUpperCase()
    if (region && WA_COUNTRY_CODES.has(region)) {
      setBuyerField("phone_country", region)
    }
  }, [phoneCountryRaw, setBuyerField])

  // Hooks must always run (never short-circuited by `??`), so compute the
  // local fallback unconditionally first, then let a real provider error win.
  const localEmailError = useLocalFieldError(
    "email",
    email,
    touched.has("email"),
  )
  const localFirstNameError = useLocalFieldError(
    "first_name",
    firstName,
    touched.has("first_name"),
  )
  const localLastNameError = useLocalFieldError(
    "last_name",
    lastName,
    touched.has("last_name"),
  )
  const localPhoneError = useLocalFieldError(
    "phone",
    phone,
    touched.has("phone"),
  )

  const emailError = buyerErrors.email ?? localEmailError
  const firstNameError = buyerErrors.first_name ?? localFirstNameError
  const lastNameError = buyerErrors.last_name ?? localLastNameError
  const phoneError = buyerErrors.phone ?? localPhoneError

  return (
    <SectionShell
      gem="flourish"
      kicker={t("checkout.amanita.buyer_kicker")}
      title={t("checkout.amanita.buyer_title")}
      intro={t("checkout.amanita.buyer_intro")}
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

        <div className="mt-6 flex flex-col gap-5">
          <div onBlurCapture={() => markTouched("email")}>
            <Field
              id="ck-email"
              label={t("form.email")}
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(v) => setBuyerField("email", v)}
              error={emailError}
            />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div onBlurCapture={() => markTouched("first_name")}>
              <Field
                id="ck-first-name"
                label={t("form.first_name")}
                autoComplete="given-name"
                placeholder={t("form.first_name_placeholder")}
                value={firstName}
                onChange={(v) => setBuyerField("first_name", v)}
                error={firstNameError}
              />
            </div>
            <div onBlurCapture={() => markTouched("last_name")}>
              <Field
                id="ck-last-name"
                label={t("form.last_name")}
                autoComplete="family-name"
                placeholder={t("form.last_name_placeholder")}
                value={lastName}
                onChange={(v) => setBuyerField("last_name", v)}
                error={lastNameError}
              />
            </div>
          </div>

          {/* WhatsApp: country select as TEXT ("AR +54", no flag emojis) +
              number. Country arrives preselected (navigator.language here,
              geo IP in production EdgeOS). */}
          <div onBlurCapture={() => markTouched("phone")}>
            <label
              htmlFor="ck-whatsapp"
              className="font-condensed text-xs font-medium uppercase tracking-[0.16em] text-primary"
            >
              {t("checkout.amanita.whatsapp_label")}
            </label>
            <div className="mt-1.5 flex gap-2">
              <select
                aria-label={t("checkout.amanita.whatsapp_country_aria")}
                autoComplete="tel-country-code"
                value={phoneCountry}
                onChange={(e) => setBuyerField("phone_country", e.target.value)}
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
                id="ck-whatsapp"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder={t("checkout.amanita.whatsapp_placeholder")}
                value={phone}
                onChange={(e) => setBuyerField("phone", e.target.value)}
                aria-invalid={phoneError ? true : undefined}
                className="w-full min-w-0 rounded-xl border px-4 py-3 text-deep outline-none transition-shadow focus:ring-2 focus:ring-accent"
                style={FIELD_INPUT_STYLE(!!phoneError)}
              />
            </div>
            {phoneError && (
              <p
                className="mt-1.5 text-xs font-semibold"
                style={{ color: "#b3271e" }}
              >
                {phoneError}
              </p>
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  )
}
