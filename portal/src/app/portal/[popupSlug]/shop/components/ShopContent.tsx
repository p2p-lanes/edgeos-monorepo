"use client"

import Link from "next/link"
import { useTranslation } from "react-i18next"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { useApplication } from "@/providers/applicationProvider"
import { getEligibleShopOffers } from "./shopOffers"

interface ShopContentProps {
  popupId: string | undefined
  popupSlug: string
}

export function resolveShopFlowSlug(
  identifier: string,
  flows: Array<{ id: string; slug: string }>,
) {
  return (
    flows.find((flow) => flow.id === identifier || flow.slug === identifier)
      ?.slug ?? null
  )
}

export function ShopContent({ popupId, popupSlug }: ShopContentProps) {
  const { t } = useTranslation()
  const { getRelevantApplication, participation } = useApplication()
  const application = usePortalSalesFlows(popupId).data ?? []
  const direct = usePortalDirectSalesFlows(popupId).data ?? []
  const upsale = usePortalUpsaleFlows(popupId).data ?? []
  const currentApplication = getRelevantApplication()
  const isApplicationApproved =
    participation?.type === "companion"
      ? participation.application_status === "accepted"
      : currentApplication?.status === "accepted"
  const offers = getEligibleShopOffers({
    application,
    direct,
    upsale,
    isApplicationApproved,
  })

  if (offers.length === 0) {
    return (
      <section className="mx-auto max-w-5xl p-6" aria-labelledby="shop-title">
        <h1 id="shop-title" className="text-2xl font-semibold">
          {t("shop.title")}
        </h1>
        <div className="mt-6 rounded-2xl border bg-card p-8 text-center">
          <h2 className="font-semibold">{t("shop.empty_title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shop.empty_description")}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section
      className="mx-auto max-w-5xl space-y-6 p-6"
      aria-labelledby="shop-title"
    >
      <div>
        <h1 id="shop-title" className="text-2xl font-semibold">
          {t("shop.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("shop.description")}
        </p>
      </div>
      {offers.map(
        ({ key, flows }) =>
          flows.length > 0 && (
            <section key={key} aria-labelledby={`shop-${key}`}>
              <h2 id={`shop-${key}`} className="mb-3 text-lg font-semibold">
                {t(`shop.${key}`)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {flows.map((flow) => (
                  <Link
                    key={flow.id}
                    href={`/portal/${popupSlug}/shop/${flow.slug}`}
                    className="rounded-2xl border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block font-medium">{flow.name}</span>
                    <span className="mt-2 block text-sm text-muted-foreground">
                      {t("shop.open")}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ),
      )}
    </section>
  )
}
