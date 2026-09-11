"use client"

import { useRouter } from "next/navigation"
import type { CSSProperties } from "react"
import type { SalesFlowPortalThemeConfig } from "@/client/types.gen"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import useResolvedAttendees from "@/hooks/useResolvedAttendees"
import { getCheckoutBackground } from "@/lib/background-image"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"
import ThemeProvider, { type ThemeConfig } from "@/providers/themeProvider"

interface ApplicationShopCheckoutProps {
  flowId: string
  flowSlug: string
  popupSlug: string
  themeConfig?: SalesFlowPortalThemeConfig | null
}

type CheckoutControlBoundaryStyle = CSSProperties & {
  "--border"?: string
  "--input"?: string
}

function toProviderThemeConfig(
  config: SalesFlowPortalThemeConfig | null | undefined,
): ThemeConfig | null | undefined {
  if (!config) return config

  const colors = config.colors
  const monochromeEmoji = colors?.checkout_nav_monochrome_emoji
  const providerColors: ThemeConfig["colors"] = colors
    ? {
        mode: colors.mode,
        primary_color: colors.primary_color,
        primary_foreground_color: colors.primary_foreground_color,
        secondary_color: colors.secondary_color,
        accent_color: colors.accent_color,
        checkout_navbar_bg: colors.checkout_navbar_bg,
        checkout_subtitle_color: colors.checkout_subtitle_color,
        checkout_bottom_bar_bg_color: colors.checkout_bottom_bar_bg_color,
        checkout_bottom_bar_text_color: colors.checkout_bottom_bar_text_color,
        checkout_watermark_color: colors.checkout_watermark_color,
        checkout_nav_text_color: colors.checkout_nav_text_color,
        checkout_nav_monochrome_emoji:
          monochromeEmoji === true
            ? "brightness(0) saturate(0) invert(1)"
            : typeof monochromeEmoji === "string"
              ? monochromeEmoji
              : undefined,
        card_background_color: colors.card_background_color,
        card_foreground_color: colors.card_foreground_color,
      }
    : undefined

  return {
    colors: providerColors,
    typography: config.typography,
    radius: config.radius,
    border_radius: config.border_radius,
  }
}

function controlBoundaryStyle(
  config: SalesFlowPortalThemeConfig | null | undefined,
): CheckoutControlBoundaryStyle | undefined {
  const border = config?.colors?.border_color
  const input = config?.colors?.input_color
  if (!border && !input) return undefined

  return {
    "--border": border,
    "--input": input,
  }
}

function FlowScopedCheckout({
  flowId,
  flowSlug,
  popupSlug,
  themeConfig,
}: ApplicationShopCheckoutProps) {
  const router = useRouter()
  const { attendeePasses, products } = usePassesProvider()
  const { getCity } = useCityProvider()
  const city = getCity()
  const background = getCheckoutBackground(city, "passes")

  if (!attendeePasses.length || !products.length) return <Loader />

  return (
    <CheckoutProvider
      initialStep="passes"
      salesFlowId={flowId}
      salesFlowSlug={flowSlug}
      flowType="application"
    >
      {background.type === "image" && (
        <CheckoutBackgroundImage url={background.url} />
      )}
      {background.type === "video" && (
        <CheckoutBackgroundVideo url={background.url} />
      )}
      <div
        className={`min-h-full w-full ${background.type === "none" ? "bg-background" : ""}`.trim()}
        style={controlBoundaryStyle(themeConfig)}
      >
        <ScrollyCheckoutFlow
          onBack={() =>
            router.push(`/portal/${popupSlug}/passes?flow=${flowSlug}`)
          }
          onPaymentComplete={() => {}}
        />
      </div>
    </CheckoutProvider>
  )
}

export function ApplicationShopCheckout({
  flowId,
  flowSlug,
  popupSlug,
  themeConfig,
}: ApplicationShopCheckoutProps) {
  const attendees = useResolvedAttendees(flowId)
  const providerThemeConfig = toProviderThemeConfig(themeConfig)

  if (!attendees.length) return <Loader />

  return (
    <ThemeProvider config={providerThemeConfig} scope="local">
      <PassesProvider
        attendees={attendees}
        restoreFromCart
        flowType="application"
        salesFlowId={flowId}
      >
        <FlowScopedCheckout
          flowId={flowId}
          flowSlug={flowSlug}
          popupSlug={popupSlug}
          themeConfig={themeConfig}
        />
      </PassesProvider>
    </ThemeProvider>
  )
}
