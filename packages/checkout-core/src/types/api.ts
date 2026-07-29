// Local mirror of the EdgeOS anonymous-checkout API contract.
//
// These types are re-declared here (not imported from the portal's generated
// client) so the core stays framework/app-agnostic and publishable on its own.
// They mirror the backend Pydantic schemas 1:1 — keep them in sync with
// `backend/app/api/checkout/schemas.py`, `.../cart/schemas.py`,
// `.../coupon/schemas.py`. Money fields are serialized by the API as decimal
// STRINGS (Pydantic Decimal → JSON string), never JS numbers — do not parse
// them into floats for display of authoritative amounts.

/** ISO decimal string, e.g. "120.00". Never a JS number (float drift). */
export type Money = string

// --- GET /checkout/{slug}/runtime -----------------------------------------

/** A product offered in the checkout runtime. */
export interface CheckoutRuntimeProduct {
  tenant_id: string
  popup_id: string
  id: string
  name: string
  slug: string
  description?: string | null
  price: Money
  compare_price?: Money | null
  image_url?: string | null
  images?: string[]
  category?: string
  currency?: string
  attendee_category?: string | null
  duration_type?: string | null
  start_date?: unknown | null
  end_date?: unknown | null
  sale_starts_at?: string | null
  sale_ends_at?: string | null
  total_stock_cap?: number | null
  total_stock_remaining?: number | null
  sold_out_override?: boolean
  max_per_order?: number | null
  is_active?: boolean
  exclusive?: boolean
  insurance_eligible?: boolean
}

// The popup / buyer_form / ticketing_steps shapes are large and only consumed
// by later tasks (step derivation, form building). They are kept as opaque
// records here and refined in `src/steps/` and `src/form/` (Plan 2 Tasks
// 2.3 / 2.6) so the transport client can stay decoupled from those modules.
export interface CheckoutRuntimeResponse {
  popup: Record<string, unknown>
  products: CheckoutRuntimeProduct[]
  buyer_form: Array<Record<string, unknown>>
  ticketing_steps: Array<Record<string, unknown>>
  attendee_categories?: Array<Record<string, unknown>>
  form_schema?: Record<string, unknown> | null
}

// --- POST /checkout/{slug}/preview ----------------------------------------

/** One product + quantity line. Shared by preview and purchase. */
export interface ProductLine {
  product_id: string
  quantity?: number
}

export interface CheckoutPreviewRequest {
  products: ProductLine[]
  coupon_code?: string | null
  insurance?: boolean
}

export interface CheckoutPreviewLine {
  product_id: string
  quantity: number
  unit_price: Money
  line_total: Money
  discountable: boolean
}

/** Authoritative server-computed price breakdown (no side effects). */
export interface CheckoutPreviewResponse {
  lines: CheckoutPreviewLine[]
  discountable_amount: Money
  non_discountable_amount: Money
  coupon_code?: string | null
  discount_value?: Money | null
  discount_amount: Money
  post_discount_amount: Money
  insurance_amount: Money
  contribution_amount: Money
  total: Money
  currency: string
}

// --- POST /checkout/{slug}/purchase ---------------------------------------

export interface BuyerInfo {
  email: string
  first_name: string
  last_name: string
  form_data?: Record<string, unknown>
}

export interface Attribution {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  fbclid?: string | null
  landing_segment?: string | null
  anonymous_id?: string | null
}

export interface OpenTicketingPurchaseCreate {
  products: ProductLine[]
  buyer: BuyerInfo
  coupon_code?: string | null
  insurance?: boolean
  fbc?: string | null
  fbp?: string | null
  locale?: string | null
  attribution?: Attribution | null
  /** Cart continuity proof (signed cart id) — allows superseding a PENDING. */
  cid?: string | null
  sig?: string | null
}

export interface OpenTicketingPurchaseResponse {
  payment_id: string
  status: string
  /** SimpleFi-hosted page where the buyer pays. Empty for zero-amount bypass. */
  checkout_url: string
  redirect_url?: string | null
  amount: Money
  currency: string
}

// --- POST /coupons/validate-public ----------------------------------------

export interface CouponValidatePublicResponse {
  code: string
  discount_type: string
  discount_value: string
  valid: boolean
}

// --- PUT / GET /checkout/{slug}/cart --------------------------------------
// The cart JSONB is a rich per-step structure; only `promo_code`, `insurance`
// and `current_step` are read at the transport level. Selection modules (Task
// 2.4) own the item shapes, so the cart state is left as an open record here.

export interface CartState {
  passes?: Array<Record<string, unknown>>
  housing?: Record<string, unknown> | null
  merch?: Array<Record<string, unknown>>
  patron?: Record<string, unknown> | null
  meal_plans?: Array<Record<string, unknown>>
  promo_code?: string | null
  insurance?: boolean
  current_step?: string | null
}

export interface OpenCartUpsert {
  email: string
  items: CartState
}

export interface OpenCartPublic {
  id: string
  popup_id: string
  email: string
  items: CartState
  restore_token?: string | null
  created_at?: string | null
  updated_at?: string | null
}
