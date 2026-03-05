export interface FormDataProps {
  first_name: string
  last_name: string
  email: string
  telegram: string
  gender: string
  email_verified: boolean
  local_resident: string
}

export type CheckoutState = "form" | "processing" | "success" | "passes"

export interface GenderOption {
  value: string
  label: string
}
