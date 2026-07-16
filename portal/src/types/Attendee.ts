import type { AttendeeProductPublic, AttendeePublic } from "@/client"
import type { ProductsPass } from "./Products"

export type AttendeeCategory = "main" | "spouse" | "kid" | "baby" | "teen"

/**
 * A single ticket entry as returned by the API's AttendeeProductPublic.
 * All denormalized product fields (product_name, product_category, start_date,
 * end_date, duration_type) are available directly — no client-side join needed.
 */
export type TicketEntry = AttendeeProductPublic

// Portal-specific: extends AttendeePublic with typed products for the passes UI state.
// ticket_entries carries the raw per-ticket AttendeeProductPublic rows from the API
// (with denormalized product_name and requires_check_in for QR display).
export type AttendeePassState = Omit<AttendeePublic, "products"> & {
  products: ProductsPass[]
  ticket_entries?: TicketEntry[]
}

export type { AttendeeProductPublic }

export interface DirectoryProduct {
  id: string
  name: string
  slug: string
  category?: string | null
  duration_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

export interface AssociatedAttendee {
  name: string
  category: string
  gender?: string | null
  email?: string | null
}

export interface AttendeeDirectory {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  telegram: string | null
  role: string | null
  organization: string | null
  residence: string | null
  age: string | null
  gender: string | null
  picture_url: string | null
  participation: DirectoryProduct[]
  check_in: string | null
  check_out: string | null
  associated_attendees: AssociatedAttendee[]
}

export interface CreateAttendee {
  name: string
  email: string
  /** @deprecated Use category_id instead — kept for backward compat with edit flows */
  category?: AttendeeCategory
  /** UUID of the attendee category row */
  category_id?: string
  gender: string
  /** Declarative required_fields answers (e.g. { age_group: "kid" }) */
  additional_data?: Record<string, unknown>
}
