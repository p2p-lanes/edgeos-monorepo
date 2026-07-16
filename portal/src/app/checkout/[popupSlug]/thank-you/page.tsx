"use client"

import { CheckCircle, Home } from "lucide-react"
import Image from "next/image"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { type CSSProperties, Suspense, useMemo } from "react"
import { useTranslation } from "react-i18next"
import FaviconOverride from "@/components/checkout-flow/FaviconOverride"
import { Button } from "@/components/ui/button"
import { imageOptimization } from "@/lib/image-optimization"
import { useTenant } from "@/providers/tenantProvider"
import { useCheckoutRuntime } from "../hooks/useCheckoutRuntime"
import { decodeOrderData, interpolate, type ThankYouTheme } from "./orderData"

function ThankYouContent() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams<{ popupSlug: string }>()
  const searchParams = useSearchParams()
  const { tenant } = useTenant()
  const { data: runtime } = useCheckoutRuntime(params.popupSlug)
  const popup = runtime?.popup as
    | {
        favicon_url?: string | null
        theme_config?: { thank_you?: ThankYouTheme } | null
      }
    | undefined

  const theme = popup?.theme_config?.thank_you
  const order = useMemo(
    () => decodeOrderData(searchParams.get("data")),
    [searchParams],
  )

  // Values available to admin-configured text templates.
  const vars: Record<string, string | undefined> = {
    first_name: order?.first_name,
    amount_total: order?.amount_total,
    currency: order?.currency,
    order_id: order?.order_id,
  }

  const title = theme?.title
    ? interpolate(theme.title, vars)
    : t("openCheckout.thank_you_title")
  const description = theme?.description
    ? interpolate(theme.description, vars)
    : t("openCheckout.thank_you_description")

  const background = theme?.background
  const outerStyle: CSSProperties =
    !background?.image_url && background?.color
      ? { backgroundColor: background.color }
      : {}

  const cardStyle: CSSProperties = theme?.text_color
    ? { color: theme.text_color }
    : {}

  const iconShow = theme?.icon?.show ?? true
  const showSummary =
    Boolean(theme?.show_order_summary) && (order?.items?.length ?? 0) > 0

  // In direct-checkout mode the user arrives via the tenant's custom domain —
  // there is no /portal/{slug} to navigate back to. Hide the CTA by default so
  // the page layout does not show a broken navigation target. An explicit theme
  // override wins over this default.
  const showBackCta = tenant?.landing_mode !== "checkout"
  const ctaShow = theme?.cta?.show ?? showBackCta
  const ctaLabel = theme?.cta?.label
    ? interpolate(theme.cta.label, vars)
    : t("openCheckout.thank_you_cta")
  const ctaUrl = theme?.cta?.url
  const onCta = () => {
    if (ctaUrl) {
      window.location.href = ctaUrl
    } else {
      router.push(`/portal/${params.popupSlug}`)
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-background px-6 py-12"
      style={outerStyle}
    >
      {background?.image_url && (
        <Image
          src={background.image_url}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          {...imageOptimization(background.image_url)}
        />
      )}
      <FaviconOverride url={popup?.favicon_url ?? null} />
      <div
        className="relative w-full max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm"
        style={cardStyle}
      >
        {iconShow && (
          <div
            className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
            style={theme?.icon?.color ? { color: theme.icon.color } : {}}
          >
            <CheckCircle className="size-9" />
          </div>
        )}

        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>

        {showSummary && (
          <div className="mt-6 rounded-xl border bg-background/50 p-4 text-left text-sm">
            <p className="mb-2 font-medium">
              {t("openCheckout.thank_you_order_summary")}
            </p>
            <ul className="space-y-1">
              {order?.items?.map((item, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only, stable order from the signed snapshot
                <li key={idx} className="flex justify-between">
                  <span>{item.name}</span>
                  <span className="text-muted-foreground">
                    ×{item.quantity}
                  </span>
                </li>
              ))}
            </ul>
            {order?.amount_total && (
              <div className="mt-3 flex justify-between border-t pt-3 font-semibold">
                <span>{t("openCheckout.thank_you_total")}</span>
                <span>
                  {order.amount_total} {order.currency}
                </span>
              </div>
            )}
          </div>
        )}

        {ctaShow && (
          <div className="mt-8 flex justify-center">
            <Button
              onClick={onCta}
              style={
                theme?.accent_color
                  ? { backgroundColor: theme.accent_color }
                  : {}
              }
            >
              {!ctaUrl && <Home className="size-4" />}
              {ctaLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function OpenCheckoutThankYouPage() {
  return (
    <Suspense fallback={null}>
      <ThankYouContent />
    </Suspense>
  )
}
