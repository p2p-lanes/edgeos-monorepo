"use client"

import type { ReactNode } from "react"
import PublicCheckoutProviders from "@/components/providers/PublicCheckoutProviders"

const InviteLayout = ({ children }: { children: ReactNode }) => {
  return <PublicCheckoutProviders>{children}</PublicCheckoutProviders>
}

export default InviteLayout
