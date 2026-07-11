import type { ReactNode } from "react"
import CheckoutClientShell from "./components/providers/CheckoutClientShell"

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return <CheckoutClientShell>{children}</CheckoutClientShell>
}
