"use client"

import { CheckCircle, Home, Ticket } from "lucide-react"
import Image from "next/image"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { type CSSProperties, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useCheckoutRuntime } from "@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime"
import {
  decodeOrderData,
  interpolate,
  type ThankYouTheme,
} from "@/app/checkout/[popupSlug]/thank-you/orderData"
import { Button } from "@/components/ui/button"
import { imageOptimization } from "@/lib/image-optimization"
import { useTenant } from "@/providers/tenantProvider"
import FaviconOverride from "./FaviconOverride"

type FlowThankYouContentProps = {
  context: "direct" | "portal"
}

export function FlowThankYouContent({ context }: FlowThankYouContentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams<{ popupSlug: string }>()
  const searchParams = useSearchParams()
  const { tenant } = useTenant()
  const flowSlug = searchParams.get("flow") || "checkout"
  const { data: runtime } = useCheckoutRuntime(params.popupSlug, { flowSlug })
  const popup = runtime?.popup as { favicon_url?: string | null } | undefined
  const theme = (runtime?.theme_config as { thank_you?: ThankYouTheme } | null)
    ?.thank_you
  const order = useMemo(
    () => decodeOrderData(searchParams.get("data")),
    [searchParams],
  )

  const vars: Record<string, string | undefined> = {
    first_name: order?.first_name,
    amount_total:
      order?.amount_total === undefined
        ? undefined
        : String(order.amount_total),
    currency: order?.currency,
    order_id: order?.order_id,
  }
  const title = theme?.title
    ? interpolate(theme.title, vars)
    : t(
        context === "portal"
          ? "portalThankYou.title"
          : "openCheckout.thank_you_title",
      )
  const description = theme?.description
    ? interpolate(theme.description, vars)
    : t(
        context === "portal"
          ? "portalThankYou.description"
          : "openCheckout.thank_you_description",
      )
  const background = theme?.background
  const outerStyle: CSSProperties =
    !background?.image_url && background?.color
      ? { backgroundColor: background.color }
      : {}
  const showSummary =
    Boolean(theme?.show_order_summary) && (order?.items?.length ?? 0) > 0
  const defaultCtaShow =
    context === "portal" || tenant?.landing_mode !== "checkout"
  const ctaShow = theme?.cta?.show ?? defaultCtaShow
  const ctaLabel = theme?.cta?.label
    ? interpolate(theme.cta.label, vars)
    : t(
        context === "portal"
          ? "portalThankYou.passes_cta"
          : "openCheckout.thank_you_cta",
      )
  const defaultCtaUrl =
    context === "portal"
      ? `/portal/${params.popupSlug}/passes`
      : `/portal/${params.popupSlug}`
  const ctaUrl = theme?.cta?.url || defaultCtaUrl

  return (
    <section
      className="relative flex min-h-full w-full items-center justify-center bg-background px-6 py-12"
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
        className="relative w-full max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm sm:p-12"
        style={theme?.text_color ? { color: theme.text_color } : {}}
      >
        {(theme?.icon?.show ?? true) && (
          <div
            className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
            style={theme?.icon?.color ? { color: theme.icon.color } : {}}
          >
            <CheckCircle className="size-9" aria-hidden="true" />
          </div>
        )}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
          {description}
        </p>

        {showSummary && (
          <div className="mt-6 rounded-xl border bg-background/50 p-4 text-left text-sm">
            <p className="mb-2 font-medium">
              {t("openCheckout.thank_you_order_summary")}
            </p>
            <ul className="space-y-1">
              {order?.items?.map((item, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only snapshot preserves backend order
                <li key={idx} className="flex justify-between">
                  <span>{item.title}</span>
                  <span className="text-muted-foreground">×{item.qty}</span>
                </li>
              ))}
            </ul>
            {order?.amount_total !== undefined && (
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
          <Button
            className="mt-8"
            onClick={() => {
              if (theme?.cta?.url) window.location.href = theme.cta.url
              else router.push(ctaUrl)
            }}
            style={
              theme?.accent_color ? { backgroundColor: theme.accent_color } : {}
            }
          >
            {!theme?.cta?.url &&
              (context === "portal" ? (
                <Ticket className="size-4" aria-hidden="true" />
              ) : (
                <Home className="size-4" aria-hidden="true" />
              ))}
            {ctaLabel}
          </Button>
        )}
      </div>
    </section>
  )
}
