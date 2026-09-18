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
- `/products` and `/form` are **publishable-key only**: without the key they
  answer **401** (`"Publishable key required"`), whichever origin they come from.
- CORS: your exact origin must be allowed by the backend. `localhost` dev origins
  are generally fine; production origins must be configured by the operator.
- `baseUrl` defaults to the EdgeOS **production** API and is optional. When you
  do override it (dev/staging/proxy) it is the **API root including the version
  prefix** (e.g. `https://api.example/api/v1`) and **must not** contain the slug.
   The client appends `/checkout/{slug}/...`. The default is exported as
  `DEFAULT_BASE_URL`.

## Sales flows: resolved for you

Sales flows are EdgeOS's own concept and no concern of a client building its own
checkout, so **nothing in the SDK takes a flow slug**. The client calls
`GET /checkout/{slug}/primary` **once** (the promise is memoized, and dropped
again if it fails so a transient error doesn't poison the client) and spends that
slug on `/preview`, `/purchase` and `/cart`.

A publishable key may only be used on that **primary** flow. A call naming any
other flow is **403**: a key must never turn a flow configured for a narrower
audience into an anonymous storefront.

### What the key relaxes (and what it never does)

On the primary flow, a publishable-key call **drops the gates that answer "may
THIS buyer buy THIS product here"**, because an SDK client renders its own
checkout and owns who reaches it:

- the **step-derived catalogue** (a product no ticketing step offers is still
  sellable; a disabled step no longer hides its products),
- the flow's **restriction rule**,
- **application / upsale eligibility** (an application-type primary flow still
  sells to a key, while the portal refuses it),
- **per-section recipient role limits** (declared on ticketing steps you don't
  render).

Everything about **money and data** is still enforced, for you exactly as for the
portal: the **sale window**, **stock**, **max per order**, **required buyer form
fields**, and the **amounts**. Inactive, deleted and accommodation shadow products
are refused too (`422 quote_unavailable`).

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

## GET `/checkout/{slug}/primary` → `PrimaryCheckoutFlow`

```ts
interface PrimaryCheckoutFlow { flow_slug: string }
```

Called for you (memoized) by every client method that needs a flow, and exposed
as `client.getPrimaryFlow()` if you want it. You never pass a flow slug in.

---

## GET `/checkout/{slug}/products` → `CheckoutProductsResponse`

The popup's **whole active catalogue**. Loaded by `store.load()`, surfaced as
`useCheckout().products` / `state.products`. **Publishable key required** (401
without it).

```ts
interface CheckoutProductsResponse {
  products: CheckoutProduct[]
}
```

Unlike the portal's flow-scoped payload, this asks no sales flow what its steps
offer: a product no step sells is listed here, and the purchase path relaxes the
same rule for a key, so everything listed can actually be bought. The server still
leaves out inactive, deleted and **accommodation shadow products** (rooms backed by
a booking, which a bare product id could never validly buy).

### `CheckoutProduct`

```ts
interface CheckoutProduct {
  tenant_id: string
  popup_id: string                      // the popup this catalogue belongs to
  id: string
  name: string
  slug: string
  price: Money
  currency?: string
  description?: string | null
  compare_price?: Money | null          // "was" price for a strikethrough
  image_url?: string | null
  images?: string[]
  category?: string                     // "ticket" is load-bearing: see recipients below
  is_active?: boolean                   // treat undefined as active; false = hide
  exclusive?: boolean                   // selecting it should clear others (UI concern)
  max_per_order?: number | null         // UI clamp; server is authoritative
  total_stock_cap?: number | null
  total_stock_remaining?: number | null // UI hint; server is authoritative
  sold_out_override?: boolean
  insurance_eligible?: boolean
  attendee_category?: string | null
  duration_type?: string | null         // e.g. housing/per-night products
  sale_starts_at?: string | null
  sale_ends_at?: string | null
  // ...plus start_date/end_date (opaque)
}
```

Product rules:
- **Filter to active**: `products.filter(p => p.is_active !== false)`.
- `max_per_order` / stock fields are **display hints only** — the server enforces
  limits at purchase. Clamp in the UI for UX, but expect the server to be the
  final word.
- `category` is how you group the catalogue into your own screens, and
  `category === "ticket"` is what makes a line need a recipient (see
  */purchase* below).

---

## GET `/checkout/{slug}/form` → `CheckoutFormResponse`

The buyer form of the popup's **primary flow**: what to render and validate
against. Loaded by `store.load()`, surfaced as `useCheckout().formSchema` /
`state.formSchema`. **Publishable key required** (401 without it).

```ts
interface CheckoutFormResponse {
  form_schema: Record<string, unknown>   // pass to buildFormZodSchema()
}
```

Shape of `form_schema` (`ApplicationFormSchema`) is documented under *Buyer form*
below. It is a separate call from `/products` because a client fetches them
independently, but it is not optional reading: `/purchase` rejects a buyer missing
a required field.

A missing popup on any of these three is an opaque **404**.

---

## POST `/checkout/{slug}/{primaryFlow}/preview` → `CheckoutPreviewResponse`

The **authoritative price**. The store calls this (debounced) whenever the cart,
coupon, or insurance changes; you read the result via `usePreview()`. No side
effects — safe to call as often as needed.

Request (`CheckoutPreviewRequest`):
```ts
{ products: ProductLine[], coupon_code?: string | null, insurance?: boolean }
// ProductLine = { product_id: string; quantity?: number; recipient_key?: string | null }
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

## POST `/checkout/{slug}/{primaryFlow}/purchase` → `OpenTicketingPurchaseResponse`

Called by `store.submit()`. Creates the payment and returns where to send the
buyer. **This does not settle the payment** — that happens on the provider page
(paid) or immediately (zero-amount).

Request (`OpenTicketingPurchaseCreate`, assembled for you by the store):
```ts
{
  products: ProductLine[]                    // { product_id, quantity?, recipient_key? }
  recipients?: PaymentRecipientRequest[]     // one entry per recipient_key used above
  buyer: { email: string; first_name: string; last_name: string; form_data?: Record<string, unknown> }
  coupon_code?: string | null
  insurance?: boolean
  cid?: string | null; sig?: string | null   // cart-continuity proof (from cart persistence)
  attribution?: Attribution | null; fbc?/fbp?/locale?  // analytics/attribution, optional
}

interface PaymentRecipientRequest {
  recipient_key: string                      // arbitrary client-side id, ties lines to a person
  name: string
  email?: string | null
  category_id?: string | null
  profile_snapshot?: Record<string, unknown> // the buyer's answers, custom_ prefix stripped
}
```

### Recipients: a ticket is always somebody's

**Every line whose product `category` is `"ticket"` must carry a
`recipient_key`**, and that key must appear in `recipients`. A ticket line that
names nobody is a **422**. The store does this for you on `submit()`:

- each ticket line gets `recipient_key: "buyer"`,
- `recipients` gets exactly one entry: `{ recipient_key: "buyer", name:
  "<first> <last>" (falling back to the email), email, profile_snapshot }` where
  `profile_snapshot` is the buyer's values with the `custom_` prefix stripped,
- non-ticket lines carry **no** recipient, and with no ticket in the cart
  `recipients` is `[]`.

That covers the common case of a buyer buying for themselves. A checkout that
sells tickets **for other people** assembles its own `products` + `recipients`
(one key per attendee) and calls `client.purchase()` directly instead of
`store.submit()`.

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

**Render `email`, `first_name` and `last_name` ALWAYS.** `base_fields` is empty
for a popup whose operator never configured the base questions, but `BuyerInfo`
requires all three no matter what: a checkout that renders only what the schema
lists collects no email and gets a 422 at payment. The store knows this, so
`buyerComplete` stays `false` until all three are filled, whatever the schema
says.

**`form_schema` (from `GET /checkout/{slug}/form`) is the source of truth for
everything else.** It drives which fields exist beyond those three:
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
- Both run on the resolved primary flow (`/checkout/{slug}/{primaryFlow}/cart`);
  you still pass no flow slug.
- The persisted `CartState` is `{ lines, promo_code, insurance, current_step }`
  (`lines` being the typed `CartLine` union: product / date_range /
  custom_amount / meal_plan / accommodation). Unknown keys are rejected
  server-side, so don't stash your own UI state in it.
