// Reference custom checkout — the minimal shape a client hosts on their own
// origin. It consumes ONLY the SDK hooks from @edgeos/checkout-react; all
// business logic (steps, pricing, cart, order assembly, submit) lives in the
// headless core. Copy this as a starting point and restyle freely — none of the
// EdgeOS theme is imported here.
//
// The whole flow:
//   1. render products from the runtime, adjust quantities  → useCart
//   2. show the server-authoritative total                  → usePreview
//   3. collect buyer info + coupon                          → useBuyerForm
//   4. submit → get { checkoutUrl } → redirect to SimpleFi  → useCheckout().submit

import {
  useBuyerForm,
  useCart,
  useCheckout,
  usePreview,
} from "@edgeos/checkout-react"
import { useState } from "react"

export interface CustomCheckoutProps {
  /** Where to send the buyer once a checkout URL is returned. Defaults to a
   *  full-page redirect (what production does); injectable for tests/embeds. */
  onCheckoutUrl?: (url: string) => void
}

export function CustomCheckout({ onCheckoutUrl }: CustomCheckoutProps) {
  const { currentStep, nextStep, previousStep, submit, submitting, runtime } =
    useCheckout()
  const { quantities, setQuantity } = useCart()
  const preview = usePreview()

  const products = runtime?.products ?? []

  if (!runtime) return <p>Loading checkout…</p>

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1>{String((runtime.popup as { name?: string }).name ?? "Checkout")}</h1>

      {currentStep !== "buyer" ? (
        <section>
          <h2>Tickets</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {products.map((p) => {
              const qty = quantities[p.id] ?? 0
              return (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                  }}
                >
                  <span>
                    {p.name} — {p.currency ?? "USD"} {p.price}
                  </span>
                  <span>
                    <button
                      type="button"
                      aria-label={`decrease ${p.name}`}
                      onClick={() => setQuantity(p.id, qty - 1)}
                    >
                      −
                    </button>
                    <output style={{ padding: "0 8px" }}>{qty}</output>
                    <button
                      type="button"
                      aria-label={`increase ${p.name}`}
                      onClick={() => setQuantity(p.id, qty + 1)}
                    >
                      +
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
          <PriceSummary preview={preview} />
          <button
            type="button"
            disabled={preview.total === null}
            onClick={() => nextStep()}
          >
            Continue
          </button>
        </section>
      ) : (
        <BuyerPanel
          preview={preview}
          submitting={submitting}
          onBack={() => previousStep()}
          onPay={async () => {
            const result = await submit()
            if (result.checkoutUrl) {
              ;(onCheckoutUrl ?? defaultRedirect)(result.checkoutUrl)
            }
          }}
        />
      )}
    </div>
  )
}

function PriceSummary({ preview }: { preview: ReturnType<typeof usePreview> }) {
  if (preview.status === "loading") return <p>Updating total…</p>
  if (preview.total === null) return <p>Add a ticket to see the total.</p>
  const p = preview.preview
  return (
    <dl>
      {p?.discount_amount && p.discount_amount !== "0" && (
        <div>
          <dt>You saved</dt>
          <dd data-testid="discount">{p.discount_amount}</dd>
        </div>
      )}
      <div>
        <dt>Total</dt>
        <dd data-testid="total">{preview.total}</dd>
      </div>
    </dl>
  )
}

function BuyerPanel({
  preview,
  submitting,
  onBack,
  onPay,
}: {
  preview: ReturnType<typeof usePreview>
  submitting: boolean
  onBack: () => void
  onPay: () => void
}) {
  const { values, setBuyer, coupon, applyCoupon } = useBuyerForm()
  const [code, setCode] = useState("")

  return (
    <section>
      <h2>Your information</h2>
      <label>
        Email
        <input
          type="email"
          value={String(values.email ?? "")}
          onChange={(e) => setBuyer({ email: e.target.value })}
        />
      </label>
      <label>
        First name
        <input
          value={String(values.first_name ?? "")}
          onChange={(e) => setBuyer({ first_name: e.target.value })}
        />
      </label>
      <label>
        Last name
        <input
          value={String(values.last_name ?? "")}
          onChange={(e) => setBuyer({ last_name: e.target.value })}
        />
      </label>

      <div>
        <input
          placeholder="Coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="button" onClick={() => applyCoupon(code)}>
          Apply
        </button>
        {coupon.code && (
          <span data-testid="coupon-state">
            {coupon.valid ? "applied" : "invalid"}
          </span>
        )}
      </div>

      <PriceSummary preview={preview} />

      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" disabled={submitting} onClick={onPay}>
        {submitting ? "Processing…" : "Pay"}
      </button>
    </section>
  )
}

function defaultRedirect(url: string): void {
  if (typeof window !== "undefined") window.location.assign(url)
}
