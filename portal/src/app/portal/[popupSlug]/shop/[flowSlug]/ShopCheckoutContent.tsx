"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import CheckoutPageClient from "@/app/checkout/[popupSlug]/CheckoutPageClient"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { resolvePortalFlowSlug } from "@/lib/portal-sales-flows"
import { useApplication } from "@/providers/applicationProvider"
import { ApplicationShopCheckout } from "./ApplicationShopCheckout"

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
  const canonicalSlug = resolvePortalFlowSlug(flowSlug, flows)
  const applicationFlow = application.find(
    (item) => item.slug === canonicalSlug,
  )
  const { getRelevantApplication } = useApplication()
  const currentApplication = getRelevantApplication(applicationFlow?.id)
  const isApplicationApproved = currentApplication?.status === "accepted"
  const collectionsLoading =
    applicationQuery.isLoading || directQuery.isLoading || upsaleQuery.isLoading

  useEffect(() => {
    if (collectionsLoading || canonicalSlug === flowSlug) return
    router.replace(
      canonicalSlug
        ? `/portal/${popupSlug}/shop/${canonicalSlug}`
        : `/portal/${popupSlug}`,
    )
  }, [canonicalSlug, collectionsLoading, flowSlug, popupSlug, router])

  if (!canonicalSlug || (collectionsLoading && canonicalSlug !== flowSlug)) {
    return <Loader />
  }

  if (applicationFlow && !isApplicationApproved) {
    return (
      <section className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">
          {t("shop.approval_required_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("shop.approval_required_description")}
        </p>
        <Link
          href={`/portal/${popupSlug}?flow=${applicationFlow.id}`}
          className="mt-6 inline-flex text-sm font-medium text-primary hover:underline"
        >
          {t("shop.approval_required_cta")}
        </Link>
      </section>
    )
  }

  if (applicationFlow) {
    return (
      <ApplicationShopCheckout
        flowId={applicationFlow.id}
        flowSlug={applicationFlow.slug}
        popupSlug={popupSlug}
        themeConfig={applicationFlow.theme_config}
      />
    )
  }

  return (
    <div className="min-h-full">
      <CheckoutPageClient
        popupSlug={popupSlug}
        flowSlug={canonicalSlug ?? flowSlug}
        showQuoteStatus
        returnContext="portal"
      />
    </div>
  )
}
