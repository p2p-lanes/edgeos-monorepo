import { ArrowRight, Package } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"
import type { OtherPurchasedProduct } from "../otherProductsProjection"

export function OtherPurchasedProducts({
  products,
  paymentsHref,
}: {
  products: OtherPurchasedProduct[]
  paymentsHref: string
}) {
  const { t } = useTranslation()

  if (products.length === 0) return null

  return (
    <section aria-labelledby="other-products-title" className="space-y-4">
      <div>
        <h2
          id="other-products-title"
          className="text-lg font-semibold text-pass-title"
        >
          {t("passes.other_products")}
        </h2>
        <p className="mt-1 text-sm text-pass-text">
          {t("passes.other_products_description")}
        </p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Package className="size-4 text-muted-foreground" />
              </div>
              <p className="truncate font-medium text-pass-title">
                {product.name}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium text-pass-text">
              × {product.quantity}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href={paymentsHref}
        className="inline-flex items-center gap-2 text-sm font-semibold text-pass-title hover:underline"
      >
        {t("passes.view_payment_details")}
        <ArrowRight className="size-4" />
      </Link>
    </section>
  )
}
