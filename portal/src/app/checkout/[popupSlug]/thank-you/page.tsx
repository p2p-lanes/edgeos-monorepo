"use client"

import { CheckCircle, Home } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export default function OpenCheckoutThankYouPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams<{ popupSlug: string }>()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle className="size-9" />
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">
          {t("openCheckout.thank_you_title")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("openCheckout.thank_you_description")}
        </p>

        <div className="mt-8 flex justify-center">
          <Button onClick={() => router.push(`/portal/${params.popupSlug}`)}>
            <Home className="size-4" />
            {t("openCheckout.thank_you_cta")}
          </Button>
        </div>
      </div>
    </div>
  )
}
