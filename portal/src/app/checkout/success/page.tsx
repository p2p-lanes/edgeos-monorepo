"use client"

import { CheckCircle, Home } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function CheckoutSuccessPage() {
  const router = useRouter()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle className="size-9" />
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">
          Payment completed successfully
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your payment was confirmed. You can continue in the portal to review
          your event information.
        </p>

        <div className="mt-8 flex justify-center">
          <Button onClick={() => router.push("/portal")}>
            <Home className="size-4" />
            Go to portal
          </Button>
        </div>
      </div>
    </div>
  )
}
