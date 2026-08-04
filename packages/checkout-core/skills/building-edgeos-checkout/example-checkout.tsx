// EdgeOS custom checkout — reference implementation.
//
// This is a COMPLETE, CORRECT integration you copy and restyle. Every EdgeOS
// contract gotcha is handled here the right way:
//   • money is rendered as strings, never parsed for authoritative amounts
//   • the price comes only from usePreview() (server-authoritative)
//   • buyer custom fields are stored with the `custom_` prefix
//   • submit() returns a checkoutUrl you redirect to — it does not "finish" the order
//   • a failed runtime load is distinguished from "still loading"
//   • buyer input is validated client-side with the SDK's own Zod builder
//
// Everything visual (inline styles, layout, copy) is a placeholder — replace it
// with your own design system. The logic is what matters.

import {
  buildFormZodSchema,
  CheckoutProvider,
  createCheckoutClient,
  useBuyerForm,
  useCart,
  useCheckout,
  usePreview,
  validateBuyerValues,
  type ApplicationFormSchema,
  type CheckoutRuntimeResponse,
  type FormFieldSchema,
} from "@edgeos/checkout-react"
import { useEffect, useMemo, useState } from "react"

// ---- config ----------------------------------------------------------------
// You only need your slug + publishable key (generate the key in the EdgeOS
// backoffice → your Organization → Checkout SDK Keys). The API URL defaults to
// EdgeOS production; add `baseUrl: "http://localhost:8000/api/v1"` below only if
// EdgeOS tells you to point at a dev/staging backend.

const SLUG = "amanita"
const PUBLISHABLE_KEY = "pk_live_xxxxxxxxxxxxxxxx"

// A shared client lets us prefetch the runtime so we can show a real error
// screen (the provider alone swallows the load error).
const client = createCheckoutClient({
  slug: SLUG,
  publishableKey: PUBLISHABLE_KEY,
  // baseUrl: "http://localhost:8000/api/v1", // dev/staging override only
})

// ---- boot: prefetch runtime, then mount the provider -----------------------

export function App() {
  const [runtime, setRuntime] = useState<CheckoutRuntimeResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    client
      .getRuntime()
      .then((r) => alive && setRuntime(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed) return <p>Couldn’t load the checkout. Please try again.</p>
  if (!runtime) return <p>Loading…</p>

  return (
    <CheckoutProvider client={client} initialRuntime={runtime} autoLoad={false}>
      <Checkout />
    </CheckoutProvider>
  )
}

// ---- the checkout ----------------------------------------------------------

export function Checkout() {
  const { runtime, submit, submitting, error } = useCheckout()
  const [paying, setPaying] = useState(false)

  if (!runtime) return null
  const products = (runtime.products ?? []).filter((p) => p.is_active !== false)
  const popupName = String((runtime.popup as { name?: string }).name ?? "Checkout")

  async function handlePay() {
    setPaying(true)
    try {
      const result = await submit()
      // Paid order: redirect to the SimpleFi hosted pay page.
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl)
        return
      }
      // Zero-amount order (e.g. 100%-off coupon): approved immediately.
      if (result.status === "approved") {
        if (result.redirectUrl) window.location.assign(result.redirectUrl)
        else window.location.assign("/checkout/success")
        return
      }
      // Anything else is a failure — `error` from the store will show it.
    } catch {
      // network / validation error; `error` is populated by the store
    } finally {
      setPaying(false)
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1>{popupName}</h1>

      <section>
        <h2>Tickets</h2>
        {products.map((p) => (
          <ProductRow key={p.id} productId={p.id} name={p.name} price={p.price} currency={p.currency} />
        ))}
      </section>

      <CouponField />
      <PriceSummary />
      <BuyerForm formSchema={runtime.form_schema as ApplicationFormSchema | null} />

      {error && <p role="alert">{error}</p>}
      <PayButton onPay={handlePay} busy={submitting || paying} />
    </main>
  )
}

// ---- product row (quantity stepper) ----------------------------------------

function ProductRow(props: {
  productId: string
  name: string
  price: string // Money — a decimal STRING; render verbatim, never parse
  currency?: string
}) {
  const { quantities, setQuantity } = useCart()
  const qty = quantities[props.productId] ?? 0
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
      <span>
        {props.name} — {props.currency ?? ""} {props.price}
      </span>
      <span>
        <button type="button" onClick={() => setQuantity(props.productId, Math.max(0, qty - 1))}>
          −
        </button>
        <output style={{ padding: "0 8px" }}>{qty}</output>
        <button type="button" onClick={() => setQuantity(props.productId, qty + 1)}>
          +
        </button>
      </span>
    </div>
  )
}

// ---- coupon ----------------------------------------------------------------

function CouponField() {
  const { coupon, applyCoupon, clearCoupon } = useBuyerForm()
  const [code, setCode] = useState("")
  return (
    <div style={{ margin: "12px 0" }}>
      <input placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="button" onClick={() => applyCoupon(code)}>
        Apply
      </button>
      {coupon.code && (
        <>
          <span> {coupon.valid ? "applied" : "invalid"}</span>
          {coupon.valid && (
            <button type="button" onClick={clearCoupon}>
              remove
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---- price summary (server-authoritative) ----------------------------------

function PriceSummary() {
  const { status, preview, total } = usePreview()
  if (total === null) return <p>Add a ticket to see the total.</p>
  const saved = preview?.discount_amount
  return (
    <dl style={{ opacity: status === "loading" ? 0.5 : 1 }}>
      {saved && Number(saved) > 0 && (
        <div>
          <dt>You saved</dt>
          <dd>{saved}</dd>
        </div>
      )}
      <div>
        <dt>Total</dt>
        <dd>
          {preview?.currency} {total}
        </dd>
      </div>
    </dl>
  )
}

// ---- buyer form (driven by runtime.form_schema) ----------------------------

function BuyerForm({ formSchema }: { formSchema: ApplicationFormSchema | null }) {
  const { values, setBuyer } = useBuyerForm()

  // Build the field list: base fields keyed by raw name, custom fields keyed
  // with the `custom_` prefix (that prefix is how the core routes them into the
  // API's form_data — without it, non-base fields are dropped).
  const fields = useMemo(() => {
    if (!formSchema) {
      return [
        { key: "email", field: { type: "email", label: "Email", required: true } as FormFieldSchema },
        { key: "first_name", field: { type: "text", label: "First name", required: true } as FormFieldSchema },
        { key: "last_name", field: { type: "text", label: "Last name", required: true } as FormFieldSchema },
      ]
    }
    const base = Object.entries(formSchema.base_fields ?? {}).map(([name, field]) => ({ key: name, field }))
    const custom = Object.entries(formSchema.custom_fields ?? {}).map(([name, field]) => ({
      key: `custom_${name}`,
      field,
    }))
    return [...base, ...custom]
  }, [formSchema])

  // Client-side validation with the SDK's own Zod builder (same rules the
  // server enforces) — avoids a round-trip 422.
  const errors = useMemo(() => {
    if (!formSchema) return {}
    return validateBuyerValues(buildFormZodSchema(formSchema), values).errors
  }, [formSchema, values])

  return (
    <section>
      <h2>Your information</h2>
      {fields.map(({ key, field }) => (
        <Field
          key={key}
          field={field}
          value={values[key]}
          // The Zod schema keys fields exactly like buyer state: base fields by
          // raw name, custom fields as custom_<name>. So errors[key] lines up.
          error={errors[key]}
          onChange={(v) => setBuyer({ [key]: v })}
        />
      ))}
    </section>
  )
}

// Minimal field renderer. Extend the switch for the field types your popup uses
// (multiselect_detailed, signature {signature, signed_at}, country_select, date,
// phone, …). Unhandled required types fall through to text and would fail
// server validation — cover the ones you actually configure.
function Field(props: {
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (v: unknown) => void
}) {
  const { field, value, error, onChange } = props
  const label = (
    <span>
      {field.label}
      {field.required && " *"}
    </span>
  )

  let control: React.ReactNode
  switch (field.type) {
    case "boolean":
    case "rich_text": // often a consent checkbox (config.is_checkbox)
      control = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      break
    case "textarea":
      control = <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      break
    case "select":
    case "radio":
      control = (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
      break
    default:
      control = (
        <input
          type={field.type === "email" ? "email" : "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }

  return (
    <label style={{ display: "block", margin: "6px 0" }}>
      {label}
      {control}
      {error && <span style={{ color: "crimson" }}> {error}</span>}
    </label>
  )
}

// ---- pay button ------------------------------------------------------------

function PayButton({ onPay, busy }: { onPay: () => void; busy: boolean }) {
  const { total } = usePreview()
  return (
    <button type="button" disabled={busy || total === null} onClick={onPay}>
      {busy ? "Processing…" : "Pay"}
    </button>
  )
}
