"use client"

import type { ReactNode } from "react"
import PublicCheckoutProviders from "@/components/providers/PublicCheckoutProviders"

const ReferralLayout = ({ children }: { children: ReactNode }) => {
  return <PublicCheckoutProviders>{children}</PublicCheckoutProviders>
}

export default ReferralLayout
