"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import CheckoutPageClient from "@/app/checkout/[popupSlug]/CheckoutPageClient"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { resolveShopFlowSlug } from "../components/ShopContent"

interface ShopCheckoutContentProps {
  popupId: string | undefined
  popupSlug: string
  flowSlug: string
}

export function ShopCheckoutContent({
  popupId,
  popupSlug,
  flowSlug,
}: ShopCheckoutContentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const applicationQuery = usePortalSalesFlows(popupId)
  const directQuery = usePortalDirectSalesFlows(popupId)
  const upsaleQuery = usePortalUpsaleFlows(popupId)
  const application = applicationQuery.data ?? []
  const direct = directQuery.data ?? []
  const upsale = upsaleQuery.data ?? []
  const flows = [...application, ...direct, ...upsale]
  const canonicalSlug = resolveShopFlowSlug(flowSlug, flows)
  const flow = flows.find((item) => item.slug === canonicalSlug)
  const collectionsLoading =
    applicationQuery.isLoading || directQuery.isLoading || upsaleQuery.isLoading

  useEffect(() => {
    if (collectionsLoading || canonicalSlug === flowSlug) return
    router.replace(
      canonicalSlug
        ? `/portal/${popupSlug}/shop/${canonicalSlug}`
        : `/portal/${popupSlug}/shop`,
    )
  }, [canonicalSlug, collectionsLoading, flowSlug, popupSlug, router])

  if (collectionsLoading || !canonicalSlug) return <Loader />

  return (
    <div className="min-h-full">
      {flow ? (
        <header className="border-b bg-card px-6 py-4">
          <p className="text-sm text-muted-foreground">{t("shop.title")}</p>
          <h1 className="text-xl font-semibold">{flow.name}</h1>
        </header>
      ) : null}
      <CheckoutPageClient
        popupSlug={popupSlug}
        flowSlug={canonicalSlug ?? flowSlug}
        showQuoteStatus
      />
    </div>
  )
}
