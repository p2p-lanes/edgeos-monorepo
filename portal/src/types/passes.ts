import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

export interface PassesProps {
  purchaseProducts: () => Promise<void>
  loading: boolean
}

export interface AttendeePassesProps {
  attendee: AttendeePassState
  index: number
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
}

export interface ProductsSnapshotProps {
  product_id: string
  attendee_id: string
  quantity: number
  product_name: string
  product_description: string | null
  product_price: number
  product_category: string
  created_at: string
}

export interface PaymentsProps {
  id: string
  application_id: string | null
  external_id: string | null
  status: "approved" | "pending" | "rejected"
  amount: number
  rate: number
  source: string | null
  currency: string
  checkout_url: string | null
  products_snapshot: ProductsSnapshotProps[]
  created_at: string
  updated_at: string
}
