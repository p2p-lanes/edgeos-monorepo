"use client"

import { ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useClearCart } from "@/hooks/useCartApi"
import { type FlowCart, useFlowCarts } from "@/hooks/useFlowCarts"
import { cn } from "@/lib/utils"

const FlowCartSection = ({
  flowCart,
  showName,
  onNavigate,
}: {
  flowCart: FlowCart
  showName: boolean
  onNavigate: () => void
}) => {
  const { t } = useTranslation()
  const { mutate: clearCart, isPending } = useClearCart(
    flowCart.popupId,
    flowCart.flowId,
  )
  const [confirming, setConfirming] = useState(false)
  const { summary } = flowCart

  const lines = [
    summary.passes > 0 && t("cartBadge.passes", { count: summary.passes }),
    summary.hasHousing && t("cartBadge.housing"),
    summary.merch > 0 && t("cartBadge.merch", { count: summary.merch }),
    summary.hasPatron && t("cartBadge.patron"),
    summary.otherItems > 0 &&
      t("cartBadge.items", { count: summary.otherItems }),
  ].filter(Boolean) as string[]

  return (
    <section>
      {showName && (
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {flowCart.name}
        </h3>
      )}
      <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Link
        href={flowCart.path}
        onClick={onNavigate}
        className={cn(buttonVariants({ size: "sm" }), "w-full")}
      >
        {t("cartBadge.go_to_checkout")}
      </Link>
      {confirming ? (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={() => setConfirming(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="flex-1"
            disabled={isPending}
            onClick={() => clearCart()}
          >
            {isPending ? t("cartBadge.clearing") : t("cartBadge.clear_confirm")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2 w-full text-destructive hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          {t("cartBadge.clear")}
        </Button>
      )}
    </section>
  )
}

const CartPopover = ({ flowCarts }: { flowCarts: FlowCart[] }) => {
  const { t } = useTranslation()
  // A link to the page already open navigates nowhere, so closing is what
  // tells the buyer the click landed.
  const [open, setOpen] = useState(false)
  const itemCount = flowCarts.reduce(
    (count, flowCart) => count + flowCart.itemCount,
    0,
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("cartBadge.aria_open")}
          className="relative flex items-center justify-center rounded-md p-1.5 text-nav-text-secondary transition-colors hover:text-nav-text"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white">
            {itemCount}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="portal-chrome max-h-[70vh] w-64 overflow-y-auto p-3"
      >
        <p className="mb-2 text-sm font-medium text-foreground">
          {t("cartBadge.title")}
        </p>
        <div className="divide-y divide-border [&>*:not(:first-child)]:mt-3 [&>*:not(:first-child)]:pt-3">
          {flowCarts.map((flowCart) => (
            <FlowCartSection
              key={flowCart.flowId}
              flowCart={flowCart}
              showName={flowCarts.length > 1}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const CartBadge = () => {
  const flowCarts = useFlowCarts().filter((flowCart) => flowCart.itemCount > 0)

  // Unmounting the popover is what stops a later cart from opening it again.
  if (flowCarts.length === 0) return null

  return <CartPopover flowCarts={flowCarts} />
}

export default CartBadge
