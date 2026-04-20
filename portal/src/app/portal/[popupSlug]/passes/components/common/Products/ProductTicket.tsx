import { Ticket } from "lucide-react"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { formatDate } from "@/helpers/dates"
import { cn } from "@/lib/utils"
import { usePassesProvider } from "@/providers/passesProvider"
import type { ProductsPass } from "@/types/Products"
import ProductDay from "./ProductDay"

type VariantStyles =
  | "selected"
  | "purchased"
  | "edit"
  | "disabled"
  | "default"
  | "week-with-month"

const variants: Record<VariantStyles, string> = {
  selected:
    "bg-green-200 border-green-400 text-green-800 hover:bg-green-200/80",
  purchased: "bg-slate-800 text-primary-foreground border-neutral-700",
  edit: "bg-slate-800/30 border-dashed border-slate-200 text-neutral-700 border",
  disabled: "bg-neutral-0 text-neutral-300 cursor-not-allowed ",
  default:
    "bg-checkout-card-bg border-neutral-300 text-checkout-title hover:bg-slate-100",
  "week-with-month":
    "bg-violet-100 border-violet-300 text-violet-800 hover:bg-violet-100/80",
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
  const disabled = product.disabled || defaultDisabled
  const originalPrice = product.original_price ?? product.price
  const { purchased, selected } = product
  const { isEditing } = usePassesProvider()

  // Check if this is a week product with month purchased/selected from same attendee
  const isWeekWithMonth =
    product.duration_type === "week" && hasMonthPurchased && !product.purchased

  if (product.duration_type === "day") {
    return (
      <ProductDay
        product={product}
        onClick={onClick}
        defaultDisabled={defaultDisabled}
        hasMonthPurchased={hasMonthPurchased}
      />
    )
  }

  const hasDescription = !!product.description && !purchased

  // Multi-unit stepper for non-day passes. Editing of already-purchased
  // multi-unit passes is intentionally out of scope (see plan) — fall back to
  // the toggle path which drives the existing "give up for credit" flow.
  const showStepper =
    supportsQuantitySelector(product.max_quantity) && !purchased && !isEditing
  const maxQuantity = resolveMaxQuantity(product)
  const currentQuantity = product.quantity ?? 0

  const emitQuantityChange = (nextQuantity: number) => {
    if (disabled) return
    onClick(product.attendee_id, { ...product, quantity: nextQuantity })
  }

  return (
    <button
      type="button"
      onClick={
        disabled || (purchased && !isEditing)
          ? undefined
          : () => {
              if (showStepper) {
                if (currentQuantity === 0 && currentQuantity < maxQuantity) {
                  emitQuantityChange(1)
                }
                return
              }
              onClick(product.attendee_id, product)
            }
      }
      disabled={disabled || (purchased && !isEditing)}
      className={cn(
        "border border-neutral-200 rounded-md p-2 relative",
        hasDescription ? "flex flex-col gap-2" : "flex items-center gap-2",
        variants[
          selected && purchased && !disabled
            ? "edit"
            : purchased
              ? "purchased"
              : disabled
                ? "disabled"
                : isWeekWithMonth
                  ? "week-with-month"
                  : selected
                    ? "selected"
                    : "default"
        ],
      )}
    >
      <div className="flex justify-between w-full">
        <div className="flex items-center justify-center">
          <div className="pl-2">
            <Ticket className="w-4 h-4" />
          </div>
          <div className="flex flex-col pl-3 ">
            <p className="font-semibold text-sm text-left">{product.name}</p>

            {product.start_date && product.end_date && (
              <span
                className={cn(
                  `text-xs text-left text-muted-foreground ${product.purchased ? "text-primary-foreground" : ""}`,
                  disabled && "text-neutral-300",
                )}
              >
                {formatDate(product.start_date, {
                  day: "numeric",
                  month: "short",
                })}{" "}
                to{" "}
                {formatDate(product.end_date, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!product.purchased && !isWeekWithMonth && (
            <>
              {originalPrice !== product.price ? (
                <p
                  className={cn(
                    "text-xs text-muted-foreground line-through",
                    disabled && "text-neutral-300",
                  )}
                >
                  ${originalPrice.toLocaleString()}
                </p>
              ) : (
                originalPrice !== product.compare_price &&
                product.compare_price && (
                  <p
                    className={cn(
                      "text-xs text-muted-foreground line-through",
                      disabled && "text-neutral-300",
                    )}
                  >
                    ${product.compare_price?.toLocaleString()}
                  </p>
                )
              )}
              <p
                className={cn(
                  "text-md font-medium",
                  disabled && "text-neutral-300",
                )}
              >
                $ {product.price?.toLocaleString()}
              </p>
            </>
          )}
          {showStepper && (
            <QuantitySelector
              size="md"
              value={currentQuantity}
              min={0}
              max={maxQuantity}
              disabled={disabled}
              onIncrement={() => emitQuantityChange(currentQuantity + 1)}
              onDecrement={() => emitQuantityChange(currentQuantity - 1)}
              onAdd={() => emitQuantityChange(1)}
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
}

export default Product
