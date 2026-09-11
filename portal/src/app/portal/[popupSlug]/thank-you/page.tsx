"use client"

import { Suspense } from "react"
import { FlowThankYouContent } from "@/components/checkout-flow/FlowThankYouContent"

export default function PortalThankYouPage() {
  return (
    <Suspense fallback={null}>
      <FlowThankYouContent context="portal" />
    </Suspense>
  )
}
