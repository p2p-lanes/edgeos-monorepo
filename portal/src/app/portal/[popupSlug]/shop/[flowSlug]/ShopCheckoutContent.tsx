"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import CheckoutPageClient from "@/app/checkout/[popupSlug]/CheckoutPageClient"
import type { CheckoutRuntimeResponse } from "@/client"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { canonicalShopTarget, isFlowUuid } from "@/lib/shop-route"
import { resolveShopFlowSlug } from "../components/ShopContent"

interface ShopCheckoutContentProps {
  popupId: string | undefined
  popupSlug: string
  flowSlug: string
  initialRuntime?: CheckoutRuntimeResponse
  initialRuntimeLanguage?: string | null
  initialRuntimeAudience?: string
}

export function ShopCheckoutContent({
  popupId,
  popupSlug,
  flowSlug,
  initialRuntime,
  initialRuntimeLanguage,
  initialRuntimeAudience,
}: ShopCheckoutContentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const search = useSearchParams().toString()
  const application = usePortalSalesFlows(popupId)
  const direct = usePortalDirectSalesFlows(popupId)
  const upsale = usePortalUpsaleFlows(popupId)
  const flows = [
    ...(application.data ?? []),
    ...(direct.data ?? []),
    ...(upsale.data ?? []),
  ]
  const knownSlug = resolveShopFlowSlug(flowSlug, flows)
  const isAlias =
    isFlowUuid(flowSlug) || Boolean(knownSlug && knownSlug !== flowSlug)
  const canonicalSlug = isAlias ? knownSlug : flowSlug
  const collectionsLoading =
    application.isLoading || direct.isLoading || upsale.isLoading
  const flow = flows.find((item) => item.slug === canonicalSlug)

  useEffect(() => {
    if (!isAlias || (!canonicalSlug && collectionsLoading)) return
    router.replace(
      canonicalShopTarget(
        popupSlug,
        canonicalSlug,
        search,
        window.location.hash,
      ),
    )
  }, [isAlias, canonicalSlug, collectionsLoading, popupSlug, search, router])

  if (!canonicalSlug) return <Loader />

  return (
    <div className="min-h-full">
      {flow ? (
        <header className="border-b bg-card px-6 py-4">
          <p className="text-sm text-muted-foreground">{t("shop.title")}</p>
          <h1 className="text-xl font-semibold">{flow.name}</h1>
        </header>
      ) : null}
      <CheckoutPageClient
        key={`${popupSlug}:${canonicalSlug}`}
        popupSlug={popupSlug}
        flowSlug={canonicalSlug}
        showQuoteStatus
        portalCheckout
        initialRuntime={initialRuntime}
        initialRuntimeLanguage={initialRuntimeLanguage}
        initialRuntimeAudience={initialRuntimeAudience}
        initialDataUpdatedAt={initialRuntime ? Date.now() : undefined}
      />
    </div>
  )
}
