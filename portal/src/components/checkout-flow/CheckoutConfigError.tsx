"use client"

import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"

export default function CheckoutConfigError() {
  const { t } = useTranslation()
  const { flowConfigError, retryFlowConfig } = useCheckout()

  return (
    <section className="mx-auto flex min-h-64 max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-sm text-foreground">
        {flowConfigError}
      </p>
      <Button type="button" onClick={retryFlowConfig}>
        {t("checkout.config_retry")}
      </Button>
    </section>
  )
}
