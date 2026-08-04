# EdgeOS Checkout — API Contract Reference

The anonymous (publishable-key) checkout surface. You normally reach these
through the hooks / store, but the shapes matter when you render. All types are
exported from `@edgeos/checkout-react` (re-exported from core). Keep this in sync
with the backend Pydantic schemas — the SDK types mirror them 1:1.

## Authentication & origin

- Send the publishable key as header `X-EdgeOS-Publishable-Key: pk_live_...`.
  The SDK's default transport does this from the `publishableKey` prop; you don't
  set it manually.
- The key resolves the **tenant** for your origin. It carries an **origin
  allowlist matched by host** (port ignored). Requests from a non-allowlisted
  origin → **HTTP 403**. Missing/invalid key → **401/403**.
- CORS: your exact origin must be allowed by the backend. `localhost` dev origins
  are generally fine; production origins must be configured by the operator.
- `baseUrl` defaults to the EdgeOS **production** API and is optional. When you
  do override it (dev/staging/proxy) it is the **API root including the version
  prefix** (e.g. `https://api.example/api/v1`) and **must not** contain the slug.
  The client appends `/checkout/{slug}/...`. The default is exported as
  `DEFAULT_BASE_URL`.

## Money

- Every monetary value is a **decimal string** (`"498000.00"`), produced from a
  server-side `Decimal`. Type alias: `Money = string`.
- **Never parse authoritative amounts into JS numbers** for storage or math —
  float drift corrupts totals. Display formatting is fine as long as the string
  stays the source of truth.
- Zero is `"0.00"` (or similar), not `"0"`. To test "is there a discount",
  prefer a numeric compare on a copy: `Number(discount_amount) > 0` for a boolean
  decision only — still render the original string.

---

## GET `/checkout/{slug}/runtime` → `CheckoutRuntimeResponse`

Loaded once on mount (`store.load()`), surfaced as `useCheckout().runtime`.

```ts
interface CheckoutRuntimeResponse {
  popup: Record<string, unknown>          // opaque; read popup.name / popup.currency defensively
  products: CheckoutRuntimeProduct[]
  buyer_form: Array<Record<string, unknown>>
  ticketing_steps: TicketingStep[]
  attendee_categories?: Array<Record<string, unknown>>
  form_schema?: Record<string, unknown> | null   // pass to buildFormZodSchema()
}
```

### `CheckoutRuntimeProduct`

```ts
interface CheckoutRuntimeProduct {
  id: string
  name: string
  slug: string
  price: Money
  currency?: string
  description?: string | null
  compare_price?: Money | null          // "was" price for a strikethrough
  image_url?: string | null
  images?: string[]
  category?: string                     // maps a product into a step (product_category)
  is_active?: boolean                   // treat undefined as active; false = hide
  exclusive?: boolean                   // selecting it should clear others (UI concern)
  max_per_order?: number | null         // UI clamp; server is authoritative
  total_stock_remaining?: number | null // UI hint; server is authoritative
  sold_out_override?: boolean
  insurance_eligible?: boolean
  attendee_category?: string | null
  duration_type?: string | null         // e.g. housing/per-night products
  sale_starts_at?: string | null
  sale_ends_at?: string | null
  // ...plus tenant_id, popup_id, start_date/end_date (opaque)
}
```

Product rules:
- **Filter to active**: `products.filter(p => p.is_active !== false)`.
- `max_per_order` / stock fields are **display hints only** — the server enforces
  limits at purchase. Clamp in the UI for UX, but expect the server to be the
  final word.

### `TicketingStep`

Only needed if you want a multi-step UI grouped exactly like the operator
configured. For a flat one-page checkout you can ignore steps entirely and just
render `runtime.products`.

```ts
interface TicketingStep {
  id: string
  step_type: string                 // structural behavior
  title: string
  order?: number
  is_enabled?: boolean
  product_category?: string | null  // join to product.category
  template?: string | null          // renderer variant hint
  template_config?: Record<string, unknown> | null
  emoji?: string | null
  show_in_navbar?: boolean
  // ...
}
```

The core derives the navigable steps for you (`useCheckout().steps`, a
`CheckoutStep[]`). Internal `CheckoutStep` ids: `passes | tickets | buyer |
housing | merch | patron | confirm | success`. **Note the API `step_type`
`"tickets"` maps to the internal id `"passes"`** — don't be surprised by the dual
name. `"success"` is a terminal UI state, not a configured step.

---

## POST `/checkout/{slug}/preview` → `CheckoutPreviewResponse`

The **authoritative price**. The store calls this (debounced) whenever the cart,
coupon, or insurance changes; you read the result via `usePreview()`. No side
effects — safe to call as often as needed.

Request (`CheckoutPreviewRequest`):
```ts
{ products: { product_id: string; quantity?: number }[], coupon_code?: string | null, insurance?: boolean }
```

Response:
```ts
interface CheckoutPreviewResponse {
  lines: CheckoutPreviewLine[]
  discountable_amount: Money      // discountable portion AFTER discount (net) — NOT a subtotal
  non_discountable_amount: Money  // portion coupons never touch
  coupon_code?: string | null
  discount_value?: Money | null   // the coupon's configured value (e.g. "10" or "5000")
  discount_amount: Money          // amount SAVED → your "You saved X"
  post_discount_amount: Money     // discountable(net) + non_discountable
  insurance_amount: Money         // added if insurance=true and eligible
  contribution_amount: Money      // mandatory platform contribution when the popup enables it
  total: Money                    // THE CHARGE. equals /purchase amount for identical inputs
  currency: string
}

interface CheckoutPreviewLine {
  product_id: string
  quantity: number
  unit_price: Money
  line_total: Money   // GROSS: unit_price × quantity, BEFORE any coupon
  discountable: boolean
}
```

Display guidance:
- **Charge** = `total`.
- **Savings** = `discount_amount` (only show if `Number(discount_amount) > 0`).
- Per-line prices: `line_total` (gross) is fine to show per row.
- **Do not** invent a "subtotal" from `discountable_amount` — it's net of the
  discount. There is no gross-subtotal field; if you need one, show the sum of
  line totals as static text you already have, but never for the charge.
- `total` already includes `contribution_amount` and `insurance_amount`.

---

## POST `/checkout/{slug}/purchase` → `OpenTicketingPurchaseResponse`

Called by `store.submit()`. Creates the payment and returns where to send the
buyer. **This does not settle the payment** — that happens on the provider page
(paid) or immediately (zero-amount).

Request (`OpenTicketingPurchaseCreate`, assembled for you by the store):
```ts
{
  products: { product_id: string; quantity?: number }[]
  buyer: { email: string; first_name: string; last_name: string; form_data?: Record<string, unknown> }
  coupon_code?: string | null
  insurance?: boolean
  cid?: string | null; sig?: string | null   // cart-continuity proof (from cart persistence)
  attribution?: Attribution | null; fbc?/fbp?/locale?  // analytics/attribution, optional
}
```

Response:
```ts
interface OpenTicketingPurchaseResponse {
  payment_id: string
  status: string           // pending | approved | rejected | expired | cancelled
  checkout_url: string     // SimpleFi hosted pay page (empty for zero-amount bypass)
  redirect_url?: string | null  // custom success URL, only for zero-amount bypass when configured
  amount: Money
  currency: string
}
```

The store maps this to `SubmitResult { status, paymentId, checkoutUrl, redirectUrl, amount, currency }` (camelCase).

**Post-submit flow (do exactly this):**
1. `status === "pending"` and `checkoutUrl` set → **redirect the browser to
   `checkoutUrl`**. The buyer pays on SimpleFi; they return via the operator's
   configured return URL. This is the normal paid path.
2. `status === "approved"` (zero-amount, e.g. 100%-off coupon) → no payment page.
   Use `redirectUrl` if present, else render your own success screen.
3. Any other `status` → treat as failure; show `useCheckout().error` /
   `SubmitResult.status`.

After the SimpleFi redirect, the buyer returns to a **return URL configured by
the operator** (not something you set in the SDK). Final settlement is confirmed
server-side via the provider webhook — your UI does not poll or reconcile payment
status; it just needs a success/landing page at that return URL.

**Purchase errors** (the `submit()` promise rejects; catch it):
- `409` with `detail.code`:
  - `pending_payment_exists` — a prior PENDING payment exists for this email and
    no cart-continuity proof was supplied.
  - `concurrent_payment_in_progress` — another checkout for the same email is live.
  - `previous_payment_completed` — already approved; may include a `redirect_url`.
- `502 payment_cancel_failed` — retry.
- `422` — validation (e.g. missing required buyer field). Prefer client-side
  validation to avoid this (see `buildFormZodSchema`).

---

## POST `/coupons/validate-public` → `CouponValidatePublicResponse`

Called by `store.applyCoupon(code)`; returns a boolean to the caller and re-prices.

```ts
interface CouponValidatePublicResponse {
  code: string
  discount_type: string    // opaque vocabulary (e.g. percentage/fixed) — don't hardcode UI on it
  discount_value: string
  valid: boolean
}
```

- A coupon can be **valid but produce no discount** for the current cart (e.g.
  only applies to some products). The real effect only shows once `/preview`
  returns with a non-zero `discount_amount`. Drive your "you saved" UI off the
  **preview**, not off validate.
- At purchase, the coupon is only sent when it validated (`coupon.valid`).

---

## Buyer form: base vs custom fields (the important one)

The backend splits buyer input in two:
- **Base fields** — `email`, `first_name`, `last_name` — travel top-level on
  `BuyerInfo`. Validated by the server directly.
- **Everything else** (phone, custom questions, dietary, waivers, …) — travels in
  `form_data`, **keyed by the raw field name**.

The SDK convention that produces this split: in the store's buyer `values`, store
base fields under their raw names and **every other field under a `custom_`
prefix**. `store.submit()` runs `stripCustomPrefix`, so `custom_phone` → sent as
`form_data.phone`. **A field you store without the `custom_` prefix (and that
isn't one of the three base fields) is dropped and never reaches the backend.**

**`form_schema` is the source of truth for rendering and validation** — use it,
not the sibling `buyer_form` array (a flatter, opaque legacy shape). `form_schema`
drives which fields exist:
```ts
interface ApplicationFormSchema {
  base_fields: Record<string, FormFieldSchema>    // key by raw name
  custom_fields: Record<string, FormFieldSchema>  // store as custom_<key>
  sections?: { id: string; label: string; description: string | null; order: number; kind: string }[]
}
interface FormFieldSchema {
  type: FormFieldType   // text|textarea|number|boolean|select|select_cards|multiselect|
                        // multiselect_detailed|radio|date|email|url|phone|rich_text|
                        // image_upload|country_select|signature
  label: string
  required: boolean
  options?: string[]
  placeholder?: string; help_text?: string
  config?: Record<string, unknown>   // e.g. signature.require_date, rich_text.is_checkbox
  width?: "full" | "half" | "half_row" | null
  // ...
}
```

**Validation error keys line up with buyer state.** `buildFormZodSchema(form_schema)`
keys the schema the same way you store values — base fields by raw name, custom
fields as `custom_<name>` — so `validateBuyerValues(schema, values).errors` is
keyed identically. Look up `errors["email"]` for a base field, `errors["custom_phone"]`
for a custom one. The builder also adds an optional virtual `gender_specify`
field; render it only if your form uses the gender "specify" companion.

Rendering tips:
- Iterate `custom_fields` and bind each to `custom_<key>` in buyer state.
- A `signature` field's value is an object `{ signature, signed_at }` — pass the
  whole object to `setBuyer` (it shallow-merges), not a string.
- The Zod builder may reference a virtual `gender_specify` companion field; if you
  don't render it, that's fine — it's optional unless the schema requires it.
- Field types you don't render fall through to text and will fail server
  validation if required — cover the types your popup actually uses.

---

## Cart persistence (optional — abandoned-cart / restore)

- `client.upsertCart({ email, items })` — persist the anonymous cart (the store
  does this automatically once a buyer email is present).
- `client.restoreCart(cid, sig)` — restore from a signed link (`?cid=&sig=`).
- The persisted `CartState` only round-trips known keys (`passes`, `housing`,
  `merch`, `patron`, `meal_plans`, `promo_code`, `insurance`, `current_step`);
  unknown keys are dropped server-side.
