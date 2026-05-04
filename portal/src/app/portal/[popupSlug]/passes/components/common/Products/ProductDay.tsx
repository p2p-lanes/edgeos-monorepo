"use client"

import { Ticket } from "lucide-react"
import { useTranslation } from "react-i18next"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { usePassesProvider } from "@/providers/passesProvider"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

type VariantStyles = "selected" | "purchased" | "edit" | "disabled" | "default"

const variants: Record<VariantStyles, string> = {
  selected:
    "bg-green-200 border-green-400 text-green-800 hover:bg-green-200/80",
  purchased: "bg-slate-800 text-primary-foreground border-neutral-700",
  edit: "bg-slate-800/30 border-dashed border-slate-200 text-neutral-700 border",
  disabled: "bg-neutral-0 text-neutral-300 cursor-not-allowed ",
  default:
    "bg-checkout-card-bg border-neutral-300 text-checkout-title hover:bg-slate-100",
}

const Product = ({
  product,
  onClick,
  defaultDisabled,
  hasMonthPurchased,
}: {
  product: ProductsPass
  onClick: (attendeeId: string | undefined, product: ProductsPass) => void
  defaultDisabled?: boolean
  hasMonthPurchased?: boolean
}) => {
  const { t } = useTranslation()
  const { isEditing } = usePassesProvider()
  const disabled =
    product.disabled || defaultDisabled || hasMonthPurchased || isEditing
  const originalPrice = product.compare_price ?? product.price
  const { purchased, selected } = product

  const showStepper = supportsQuantitySelector(product.max_quantity)
  const maxQuantity = resolveMaxQuantity(product, {
    dayPassFallbackToDateRange: true,
  })

  const currentQuantity = product.quantity ?? 0
  const minQuantity = purchased ? (product.original_quantity ?? 1) : 0

  const handleSumQuantity = () => {
    if (currentQuantity >= maxQuantity) return
    onClick(product.attendee_id, { ...product, quantity: currentQuantity + 1 })
  }

  const handleSubtractQuantity = () => {
    if (currentQuantity <= minQuantity) return
    onClick(product.attendee_id, { ...product, quantity: currentQuantity - 1 })
  }

  const handleToggleClick = () => {
    // max_quantity === 1 path — behaves as a toggle.
    onClick(product.attendee_id, {
      ...product,
      quantity: selected ? 0 : 1,
    })
  }

  const handleMainClick = () => {
    if (disabled) return
    if (!showStepper) {
      handleToggleClick()
      return
    }
    // Stepper path — clicking the card body adds one unit when empty.
    if (currentQuantity === 0) handleSumQuantity()
  }

  const hasDescription = !!product.description && !purchased

  const buttonNode = (
    <button
      type="button"
      onClick={handleMainClick}
      className={cn(
        "border border-neutral-200 rounded-md p-2 relative cursor-pointer w-full text-left",
        hasDescription ? "flex flex-col gap-2" : "flex items-center gap-2",
        variants[
          purchased
            ? "purchased"
            : disabled
              ? "disabled"
              : selected
                ? "selected"
                : "default"
        ],
        disabled && "cursor-not-allowed",
      )}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      disabled={disabled}
    >
      <div className="flex justify-between w-full flex-wrap">
        <div className="flex md:items-center md:gap-2 flex-col md:flex-row">
          <div className="flex items-center pl-2">
            <Ticket className="w-4 h-4 hidden md:block" />
            <p className="font-semibold text-sm md:pl-3">{product.name}</p>
          </div>
        </div>

        {/* Right Side: Price and optional QuantitySelector */}
        <div className="flex flex-col items-end justify-center md:flex-row md:items-center md:gap-2">
          <div className="flex items-center gap-2">
            {!disabled && (
              <>
                {originalPrice !== product.price && (
                  <p
                    className={cn(
                      "text-xs text-muted-foreground line-through",
                      disabled && "text-neutral-300",
                    )}
                  >
                    {formatCurrency(originalPrice)}
                  </p>
                )}
                <p
                  className={cn(
                    "text-md font-medium",
                    disabled && "text-neutral-300",
                  )}
                >
                  {formatCurrency(product.price)}
                </p>
              </>
            )}
          </div>

          {showStepper && !disabled && (
            <QuantitySelector
              size="md"
              value={currentQuantity}
              min={minQuantity}
              max={maxQuantity}
              disabled={disabled}
              onIncrement={handleSumQuantity}
              onDecrement={handleSubtractQuantity}
              onAdd={handleSumQuantity}
            />
          )}
        </div>
      </div>

      {hasDescription && product.description && (
        <div className="w-full pl-2 pr-1">
          <ExpandableDescription
            text={product.description}
            clamp={2}
            className={cn(
              "text-xs text-left text-muted-foreground",
              disabled && "text-neutral-300",
            )}
          />
        </div>
      )}
    </button>
  )

  if (hasMonthPurchased) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{buttonNode}</TooltipTrigger>
        <TooltipContent className="bg-card text-foreground shadow-md border border-border max-w-sm">
          {t("passes.monthly_pass_collision")}
        </TooltipContent>
      </Tooltip>
    )
  }

  return buttonNode
}

export default Product
