import { useQueries } from "@tanstack/react-query"
import { ArrowRight, ChevronRight, CircleCheck, QrCode } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PaymentsService, TicketingStepsService } from "@/client"
import { PaymentFormResponses } from "@/components/payments/PaymentFormResponses"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { imageOptimization } from "@/lib/image-optimization"
import { formatRelative } from "@/lib/relativeTime"
import { cn } from "@/lib/utils"
import type { OtherPurchasedProduct } from "../otherProductsProjection"
import { resolveOtherProductVisual } from "../otherProductVisual"
import QRcode from "./common/QRcode"

export function OtherPurchasedProducts({
  products,
  paymentsHref,
  popupId,
  catalog = [],
}: {
  products: OtherPurchasedProduct[]
  paymentsHref: string
  /** Scopes the step lookup that picks each product's icon. */
  popupId?: string
  /** Products the portal already loaded, for their images. */
  catalog?: Array<{ id: string; image_url?: string | null }>
}) {
  const { t, i18n } = useTranslation()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Resolve the selection from current data, so a unit revoked on refetch
  // also closes its QR.
  const flowIds = [...new Set(products.map((product) => product.salesFlowId))]
  // Same key as the checkout's own step query, so a buyer who just paid
  // reads these from cache.
  const stepQueries = useQueries({
    queries: flowIds.map((salesFlowId) => ({
      queryKey: ["ticketing-steps-portal", popupId ?? null, salesFlowId],
      queryFn: () =>
        TicketingStepsService.listPortalTicketingSteps({
          popupId: popupId!,
          salesFlowId,
        }),
      enabled: !!popupId,
    })),
  })
  const stepsByFlow = new Map(
    flowIds.map((flowId, index) => [
      flowId,
      stepQueries[index]?.data?.results ?? [],
    ]),
  )

  // A payment ID alone does not imply that the detail popup has content.
  const paymentIds = [
    ...new Set(
      products
        .filter((product) => !product.checkInCode && product.paymentId)
        .map((product) => product.paymentId!),
    ),
  ]
  const responseQueries = useQueries({
    queries: paymentIds.map((paymentId) => ({
      queryKey: ["payment-form-responses", paymentId],
      queryFn: () => PaymentsService.getMyFormResponses({ paymentId }),
      retry: false,
    })),
  })
  const paymentsWithForm = new Set(
    paymentIds.filter(
      (_, index) => !!responseQueries[index]?.data?.fields.length,
    ),
  )
  const hasDetails = (product: OtherPurchasedProduct) =>
    !!product.checkInCode ||
    (!!product.paymentId && paymentsWithForm.has(product.paymentId))
  const active = products.find(
    (product) => product.key === selectedKey && hasDetails(product),
  )

  if (products.length === 0) return null

  const qrTitle = (product: OtherPurchasedProduct) =>
    product.total > 1
      ? t("orders.unit_qr_title", {
          product: product.name,
          number: product.number,
        })
      : product.name

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
        {products.map((product) => {
          const { imageUrl, Icon } = resolveOtherProductVisual(
            product,
            stepsByFlow.get(product.salesFlowId) ?? [],
            catalog,
          )
          const used = product.lastScanAt != null
          const position =
            product.total > 1
              ? t("passes.other_product_position", {
                  number: product.number,
                  total: product.total,
                })
              : null

          const content = (
            <>
              <div
                className={cn(
                  "shrink-0 transition-opacity",
                  used && "opacity-50 grayscale",
                )}
              >
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 rounded-xl bg-muted object-cover"
                    {...imageOptimization(imageUrl)}
                  />
                ) : (
                  <div className="grid size-11 place-items-center rounded-xl bg-muted">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-[15px] font-semibold leading-snug",
                    used ? "text-pass-text" : "text-pass-title",
                  )}
                >
                  {product.name}
                </p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-pass-text">
                  {position && <span className="shrink-0">{position}</span>}
                  {position && product.checkInCode && (
                    <span aria-hidden="true">·</span>
                  )}
                  {product.checkInCode &&
                    (used ? (
                      // The "Used" pill already says what happened; the
                      // line only adds when, so it fits on a phone.
                      <span className="truncate">
                        {formatRelative(product.lastScanAt!, i18n.language)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-current" />
                        {t("passes.other_product_ready")}
                      </span>
                    ))}
                </p>
              </div>

              {!product.checkInCode && hasDetails(product) && (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              {product.checkInCode &&
                (used ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    <CircleCheck className="size-3.5" />
                    {t("passes.other_product_used")}
                  </span>
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background text-pass-title shadow-xs transition-colors group-hover:bg-muted">
                    <QrCode className="size-5" />
                  </span>
                ))}
            </>
          )

          return (
            <li key={product.key}>
              {hasDetails(product) ? (
                <button
                  type="button"
                  onClick={() => setSelectedKey(product.key)}
                  aria-label={
                    product.checkInCode
                      ? t("orders.show_unit_qr_label", {
                          product: product.name,
                          number: product.number,
                        })
                      : t("passes.purchase_details_label", {
                          product: product.name,
                        })
                  }
                  className="group flex min-h-[72px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none active:bg-muted/60"
                >
                  {content}
                </button>
              ) : (
                <div className="flex min-h-[72px] items-center gap-3 px-4 py-3">
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Link
        href={paymentsHref}
        className="inline-flex items-center gap-2 text-sm font-semibold text-pass-title hover:underline"
      >
        {t("passes.view_payment_details")}
        <ArrowRight className="size-4" />
      </Link>

      <QRcode
        check_in_code={active?.checkInCode ?? ""}
        lastScanAt={active?.lastScanAt ?? null}
        isOpen={!!active?.checkInCode}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null)
        }}
        title={active ? qrTitle(active) : ""}
        description={t("orders.unit_qr_description")}
      >
        {active?.checkInCode && active.paymentId && (
          <PaymentFormResponses paymentId={active.paymentId} />
        )}
      </QRcode>
      <Dialog
        open={!!active && !active.checkInCode}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          aria-describedby={undefined}
        >
          <DialogTitle>{active?.name}</DialogTitle>
          {active?.paymentId && (
            <PaymentFormResponses paymentId={active.paymentId} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
