"use client"

import { Suspense } from "react"
import { FlowThankYouContent } from "@/components/checkout-flow/FlowThankYouContent"

export default function OpenCheckoutThankYouPage() {
  return (
    <Suspense fallback={null}>
      <div className="min-h-screen">
        <FlowThankYouContent context="direct" />
      </div>
    </Suspense>
  )
}
