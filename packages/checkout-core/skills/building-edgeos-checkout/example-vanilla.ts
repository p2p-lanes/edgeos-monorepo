// EdgeOS custom checkout — framework-agnostic reference implementation.
//
// This is a COMPLETE, CORRECT integration using ONLY @edgeos/checkout-core — no
// React, no framework. It wires the store to plain DOM. Every EdgeOS contract
// gotcha is handled here the right way:
//   • money is rendered as strings, never parsed for authoritative amounts
//   • the price comes only from state.pricing.preview (server-authoritative)
//   • buyer custom fields are stored with the `custom_` prefix
//   • submit() returns a checkoutUrl you redirect to — it does not "finish" the order
//   • a failed runtime load is distinguished from "still loading" (we prefetch)
//   • buyer input is validated with the SDK's own Zod builder
//
// The DOM plumbing (createElement, innerHTML) is a placeholder — port the SAME
// store calls to Vue's reactive()/onMounted, Svelte stores, Solid signals, etc.
// The store contract is identical everywhere; only the render layer changes.

import {
  buildFormZodSchema,
  createCheckoutClient,
  createCheckoutStore,
  validateBuyerValues,
  type ApplicationFormSchema,
  type CheckoutStoreState,
  type FormFieldSchema,
} from "@edgeos/checkout-core"

// ---- config ----------------------------------------------------------------
// You only need your slug + publishable key (generate the key in the EdgeOS
// backoffice → your Organization → Checkout SDK Keys). The API URL defaults to
// EdgeOS production; add `baseUrl: "http://localhost:8000/api/v1"` below only if
// EdgeOS tells you to point at a dev/staging backend.

const SLUG = "amanita"
const PUBLISHABLE_KEY = "pk_live_xxxxxxxxxxxxxxxx"

// ---- boot ------------------------------------------------------------------

export async function mountCheckout(root: HTMLElement): Promise<() => void> {
  const client = createCheckoutClient({
    slug: SLUG,
    publishableKey: PUBLISHABLE_KEY,
    // baseUrl: "http://localhost:8000/api/v1", // dev/staging override only
  })

  // Prefetch the runtime ourselves so we can show a real error screen — the
  // store's own load() swallows the fetch error (runtime just stays null).
  root.textContent = "Loading…"
  let runtime
  try {
    runtime = await client.getRuntime()
  } catch {
    root.textContent = "Couldn’t load the checkout. Please try again."
    return () => {}
  }

  // Seed the runtime so the store doesn't fetch it again.
  const store = createCheckoutStore({ client, runtime })

  // Subscribe: render() runs on EVERY state change (cart, pricing, buyer, …).
  const unsubscribe = store.subscribe((state) => render(root, store, state))
  render(root, store, store.getState()) // initial paint

  // Return a teardown you call on unmount / route change.
  return () => {
    unsubscribe()
    store.dispose()
  }
}

// ---- render ----------------------------------------------------------------
// A dumb full re-render for clarity. Swap for targeted DOM updates or a
// framework's reactivity in real code — the store calls stay the same.

type Store = ReturnType<typeof createCheckoutStore>

function render(root: HTMLElement, store: Store, state: CheckoutStoreState) {
  const { runtime, selection, pricing, buyer } = state
  if (!runtime) return

  const products = (runtime.products ?? []).filter((p) => p.is_active !== false)
  const popupName = String((runtime.popup as { name?: string }).name ?? "Checkout")
  const preview = pricing.preview
  const total = preview?.total ?? null // Money string, or null when cart is empty
  const saved = preview?.discount_amount

  root.replaceChildren()
  const h = (tag: string, text?: string) => {
    const el = document.createElement(tag)
    if (text != null) el.textContent = text
    return el
  }

  root.append(h("h1", popupName))

  // --- tickets (quantity steppers) ---
  const tickets = h("section")
  tickets.append(h("h2", "Tickets"))
  for (const p of products) {
    const qty = selection.quantities[p.id] ?? 0
    const row = h("div")
    row.append(h("span", `${p.name} — ${p.currency ?? ""} ${p.price}`)) // price rendered verbatim

    const minus = h("button", "−") as HTMLButtonElement
    minus.onclick = () => store.setQuantity(p.id, Math.max(0, qty - 1))
    const count = h("output", String(qty))
    const plus = h("button", "+") as HTMLButtonElement
    plus.onclick = () => store.setQuantity(p.id, qty + 1)

    row.append(minus, count, plus)
    tickets.append(row)
  }
  root.append(tickets)

  // --- coupon ---
  const couponBox = h("div")
  const couponInput = h("input") as HTMLInputElement
  couponInput.placeholder = "Coupon code"
  const applyBtn = h("button", "Apply") as HTMLButtonElement
  // applyCoupon resolves false for an invalid code (it never throws) and reprices.
  applyBtn.onclick = () => void store.applyCoupon(couponInput.value)
  couponBox.append(couponInput, applyBtn)
  if (state.coupon.code) {
    couponBox.append(h("span", ` ${state.coupon.valid ? "applied" : "invalid"}`))
    if (state.coupon.valid) {
      const removeBtn = h("button", "remove") as HTMLButtonElement
      removeBtn.onclick = () => store.clearCoupon()
      couponBox.append(removeBtn)
    }
  }
  root.append(couponBox)

  // --- price summary (server-authoritative) ---
  const summary = h("dl")
  summary.style.opacity = pricing.status === "loading" ? "0.5" : "1"
  if (total === null) {
    summary.append(h("p", "Add a ticket to see the total."))
  } else {
    if (saved && Number(saved) > 0) {
      summary.append(h("dt", "You saved"), h("dd", saved)) // discount_amount = savings
    }
    summary.append(h("dt", "Total"), h("dd", `${preview?.currency ?? ""} ${total}`))
  }
  root.append(summary)

  // --- buyer form (driven by runtime.form_schema) ---
  // buyer.values: base fields raw, custom fields keyed as custom_<name>.
  root.append(buildBuyerForm(store, runtime.form_schema as ApplicationFormSchema | null, buyer.values))

  // --- error + pay ---
  if (state.error) {
    const err = h("p", state.error)
    err.setAttribute("role", "alert")
    root.append(err)
  }
  const payBtn = h("button", state.submitting ? "Processing…" : "Pay") as HTMLButtonElement
  payBtn.disabled = state.submitting || total === null // gate on a priced cart
  payBtn.onclick = () => void handlePay(store)
  root.append(payBtn)
}

// ---- buyer form ------------------------------------------------------------

function buildBuyerForm(
  store: Store,
  formSchema: ApplicationFormSchema | null,
  buyer: Record<string, unknown>,
): HTMLElement {
  const section = document.createElement("section")
  const heading = document.createElement("h2")
  heading.textContent = "Your information"
  section.append(heading)

  // Base fields keyed by raw name; custom fields keyed with the `custom_` prefix.
  // That prefix is how the core routes them into the API's form_data — without
  // it, non-base fields are silently dropped.
  const fields: Array<{ key: string; field: FormFieldSchema }> = []
  if (!formSchema) {
    fields.push(
      { key: "email", field: { type: "email", label: "Email", required: true } as FormFieldSchema },
      { key: "first_name", field: { type: "text", label: "First name", required: true } as FormFieldSchema },
      { key: "last_name", field: { type: "text", label: "Last name", required: true } as FormFieldSchema },
    )
  } else {
    for (const [name, field] of Object.entries(formSchema.base_fields ?? {})) {
      fields.push({ key: name, field })
    }
    for (const [name, field] of Object.entries(formSchema.custom_fields ?? {})) {
      fields.push({ key: `custom_${name}`, field })
    }
  }

  // Client-side validation with the SDK's own Zod builder (same rules the server
  // enforces) — avoids a round-trip 422. Keys line up with buyer state.
  const errors = formSchema ? validateBuyerValues(buildFormZodSchema(formSchema), buyer).errors : {}

  for (const { key, field } of fields) {
    section.append(buildField(store, key, field, buyer[key], errors[key]))
  }
  return section
}

// Minimal field renderer. Extend for the field types your popup uses
// (multiselect_detailed, signature {signature, signed_at}, country_select, date,
// phone, …). Unhandled required types fall through to text and would fail server
// validation — cover the ones you actually configure.
function buildField(
  store: Store,
  key: string,
  field: FormFieldSchema,
  value: unknown,
  error?: string,
): HTMLElement {
  const label = document.createElement("label")
  label.style.display = "block"
  label.append(document.createTextNode(`${field.label}${field.required ? " *" : ""} `))

  // setBuyer shallow-merges — store base fields raw, custom fields as custom_<name>.
  let control: HTMLElement
  switch (field.type) {
    case "boolean":
    case "rich_text": {
      const cb = document.createElement("input")
      cb.type = "checkbox"
      cb.checked = !!value
      cb.onchange = () => store.setBuyer({ [key]: cb.checked })
      control = cb
      break
    }
    case "textarea": {
      const ta = document.createElement("textarea")
      ta.value = String(value ?? "")
      ta.oninput = () => store.setBuyer({ [key]: ta.value })
      control = ta
      break
    }
    case "select":
    case "radio": {
      const sel = document.createElement("select")
      const blank = document.createElement("option")
      blank.value = ""
      blank.textContent = "—"
      sel.append(blank)
      for (const o of field.options ?? []) {
        const opt = document.createElement("option")
        opt.value = o
        opt.textContent = o
        sel.append(opt)
      }
      sel.value = String(value ?? "")
      sel.onchange = () => store.setBuyer({ [key]: sel.value })
      control = sel
      break
    }
    default: {
      const input = document.createElement("input")
      input.type = field.type === "email" ? "email" : "text"
      input.value = String(value ?? "")
      if (field.placeholder) input.placeholder = field.placeholder
      input.oninput = () => store.setBuyer({ [key]: input.value })
      control = input
    }
  }

  label.append(control)
  if (error) {
    const e = document.createElement("span")
    e.style.color = "crimson"
    e.textContent = ` ${error}`
    label.append(e)
  }
  return label
}

// ---- submit ----------------------------------------------------------------

async function handlePay(store: Store): Promise<void> {
  try {
    const result = await store.submit()
    // Paid order: redirect to the SimpleFi hosted pay page.
    if (result.checkoutUrl) {
      window.location.assign(result.checkoutUrl)
      return
    }
    // Zero-amount order (e.g. 100%-off coupon): approved immediately.
    if (result.status === "approved") {
      window.location.assign(result.redirectUrl ?? "/checkout/success")
      return
    }
    // Anything else is a failure — state.error (rendered above) will show it.
  } catch {
    // network / validation error; the store sets state.error and re-renders.
  }
}
