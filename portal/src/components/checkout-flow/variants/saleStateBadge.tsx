"use client"

/**
 * Small presentational badge for a product's non-`on_sale` sale state.
 *
 * Shared by the ticket and meal-plan checkout variants so both surface the
 * same UPCOMING / ENDED / SOLD OUT chips with identical styling. Renders
 * nothing while the product is `on_sale`.
 */

import { useTranslation } from "react-i18next"
import type { ProductSaleState } from "@/lib/product-state"
import { cn } from "@/lib/utils"

export function SaleStateBadge({ state }: { state: ProductSaleState }) {
  const { t } = useTranslation()
  if (state === "on_sale") return null
  // Display casing (UPCOMING / ENDED / SOLD OUT) comes from the `uppercase`
  // class below, so translations stay in natural sentence case.
  const config: Record<
    Exclude<ProductSaleState, "on_sale">,
    { label: string; classes: string }
  > = {
    upcoming: {
      label: t("checkout.sale_upcoming", { defaultValue: "Upcoming" }),
      classes: "bg-blue-100 text-blue-700 border-blue-200",
    },
    ended: {
      label: t("checkout.sale_ended", { defaultValue: "Ended" }),
      classes: "bg-slate-100 text-slate-500 border-slate-200",
    },
    sold_out: {
      label: t("checkout.sold_out", { defaultValue: "Sold out" }),
      classes: "bg-rose-100 text-rose-700 border-rose-200",
    },
  }
  const { label, classes } = config[state]
  return (
    <span
      className={cn(
        "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border shrink-0",
        classes,
      )}
    >
      {label}
    </span>
  )
}
