import type { AttendeePassState } from "./Attendee"
import type { ProductsPass } from "./Products"

// --- Step Types ---
// "tickets" is the API/DB step_type; "passes" is the legacy internal name (kept for compat)
export type CheckoutStep =
  | "passes"
  | "tickets"
  | "housing"
  | "merch"
  | "patron"
  | "confirm"
  | "success"

export interface StepConfig {
  id: CheckoutStep
  label: string
  description: string
  icon: string
  optional: boolean
}

export const CHECKOUT_STEPS: StepConfig[] = [
  {
    id: "passes",
    label: "Passes",
    description: "Select your passes",
    icon: "Ticket",
    optional: false,
  },
  {
    id: "patron",
    label: "Patron",
    description: "Support the community",
    icon: "Heart",
    optional: true,
  },
  {
    id: "housing",
    label: "Housing",
    description: "Book accommodation",
    icon: "Home",
    optional: true,
  },
  {
    id: "merch",
    label: "Merch",
    description: "Get official merch",
    icon: "ShoppingBag",
    optional: true,
  },
  {
    id: "confirm",
    label: "Confirm",
    description: "Review and pay",
    icon: "CheckCircle",
    optional: false,
  },
]

// --- Selected Items ---
export interface SelectedPassItem {
  productId: string
  product: ProductsPass
  attendeeId: string
  attendee: AttendeePassState
  quantity: number
  price: number
  originalPrice?: number
}

export interface SelectedHousingItem {
  productId: string
  product: ProductsPass
  checkIn: string
  checkOut: string
  nights: number
  pricePerNight: number
  totalPrice: number
  pricePerDay: boolean
  quantity: number
}

export interface SelectedMerchItem {
  productId: string
  product: ProductsPass
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface SelectedPatronItem {
  productId: string
  product: ProductsPass
  amount: number
  isCustomAmount: boolean
}

export interface SelectedDynamicItem {
  productId: string
  product: ProductsPass
  quantity: number
  price: number
  stepType: string
}

// --- Cart State ---
export interface CheckoutCartState {
  passes: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  promoCode: string
  promoCodeValid: boolean
  promoCodeDiscount: number
  insurance: boolean
  insurancePrice: number
  insurancePotentialPrice: number
  dynamicItems: Record<string, SelectedDynamicItem[]>
}

// --- Cart Summary ---
export interface CheckoutCartSummary {
  passesSubtotal: number
  housingSubtotal: number
  merchSubtotal: number
  patronSubtotal: number
  insuranceSubtotal: number
  dynamicSubtotal: number
  subtotal: number
  discount: number
  credit: number
  grandTotal: number
  itemCount: number
}

// --- Patron Presets ---
export const PATRON_PRESETS = [2500, 5000, 7500]
export const PATRON_MINIMUM = 1000

// --- Insurance ---
export const INSURANCE_BENEFITS = [
  "Full refund up to 14 days before the event",
  "50% refund up to 7 days before",
  "Free date change at no extra cost",
]

// --- Utility Functions ---
export function calculateNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn)
  const end = new Date(checkOut)
  const diffTime = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(amount)
}

export function formatCheckoutDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function getStepIndex(step: CheckoutStep): number {
  return CHECKOUT_STEPS.findIndex((s) => s.id === step)
}

export function isStepComplete(
  step: CheckoutStep,
  cart: CheckoutCartState,
): boolean {
  switch (step) {
    case "passes":
      return cart.passes.length > 0
    case "housing":
    case "merch":
    case "patron":
      return true
    case "confirm":
      return false
    case "success":
      return true
    default:
      return false
  }
}

export function createInitialCartState(): CheckoutCartState {
  return {
    passes: [],
    housing: null,
    merch: [],
    patron: null,
    promoCode: "",
    promoCodeValid: false,
    promoCodeDiscount: 0,
    insurance: false,
    insurancePrice: 0,
    insurancePotentialPrice: 0,
    dynamicItems: {},
  }
}

export function createInitialSummary(): CheckoutCartSummary {
  return {
    passesSubtotal: 0,
    housingSubtotal: 0,
    merchSubtotal: 0,
    patronSubtotal: 0,
    insuranceSubtotal: 0,
    dynamicSubtotal: 0,
    subtotal: 0,
    discount: 0,
    credit: 0,
    grandTotal: 0,
    itemCount: 0,
  }
}
