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
      <section
        className="mx-auto max-w-6xl p-4 sm:p-6"
        aria-labelledby="shop-title"
      >
        <h1 id="shop-title" className="text-2xl font-semibold">
          {t("shop.title")}
        </h1>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
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
      className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6"
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
              <h2
                id={`shop-${key}`}
                className="mb-3 border-l-4 border-sky-500 pl-3 text-lg font-semibold text-slate-900"
              >
                {t(`shop.${key}`)}
              </h2>
              <ul
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                aria-label={t("shop.catalog")}
              >
                {flows.map((flow) => (
                  <li key={flow.id}>
                    <Link
                      href={`/portal/${popupSlug}/shop/${flow.slug}`}
                      className="group block overflow-hidden rounded-xl border border-slate-200 border-t-4 border-t-sky-500 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-xs font-semibold tracking-[0.08em] text-slate-500 uppercase">
                        {t(`shop.${key}`)}
                      </span>
                      <span className="mt-1 block font-semibold text-slate-900">
                        {flow.name}
                      </span>
                      <span className="mt-4 inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
                        {t("shop.open")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </section>
  )
}
