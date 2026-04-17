import type { CheckoutMode, SaleType } from "@/client"
import { Badge } from "@/components/ui/badge"
import { InlineRow } from "@/components/ui/inline-form"

interface CheckoutModeDisplay {
  badgeLabel: CheckoutMode
  description: string
  mapping: string
}

interface GetCheckoutModeDisplayParams {
  saleType: SaleType
  checkoutMode: CheckoutMode
}

export function getCheckoutModeDisplay({
  saleType,
  checkoutMode,
}: GetCheckoutModeDisplayParams): CheckoutModeDisplay {
  if (saleType === "direct") {
    return {
      badgeLabel: checkoutMode,
      mapping: "direct → simple_quantity",
      description:
        "Direct sale always derives the simple_quantity checkout flow. Change sale type if you need the pass-system checkout instead.",
    }
  }

  return {
    badgeLabel: checkoutMode,
    mapping: "application → pass_system",
    description:
      "Application popups always derive the pass_system checkout flow. Operators can only change sale type — checkout mode stays server-authoritative.",
  }
}

interface PopupCheckoutModeInfoProps {
  saleType: SaleType
  checkoutMode: CheckoutMode
}

export function PopupCheckoutModeInfo({
  saleType,
  checkoutMode,
}: PopupCheckoutModeInfoProps) {
  const display = getCheckoutModeDisplay({ saleType, checkoutMode })

  return (
    <InlineRow
      label="Checkout mode"
      description={`${display.mapping}. ${display.description}`}
    >
      <Badge variant="outline">{display.badgeLabel}</Badge>
    </InlineRow>
  )
}
