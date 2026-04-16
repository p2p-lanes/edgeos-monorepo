"use client"

import { Check, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

/* ── Shared components ────────────────────────────────────── */

interface MerchQtyControlProps {
  product: ProductsPass
  quantity: number
  onQuantityChange: (qty: number) => void
}

/**
 * Renders the shared QuantitySelector for merch items whose max_quantity
 * allows more than one unit; renders a single-shot Add/Added toggle button
 * when max_quantity === 1.
 */
function MerchQtyControl({
  product,
  quantity,
  onQuantityChange,
}: MerchQtyControlProps) {
  const showStepper = supportsQuantitySelector(product.max_quantity)
  const max = product.max_quantity ?? Number.POSITIVE_INFINITY

  if (showStepper) {
    return (
      <QuantitySelector
        size="md"
        value={quantity}
        min={0}
        max={max}
        onIncrement={() => onQuantityChange(quantity + 1)}
        onDecrement={() => onQuantityChange(Math.max(0, quantity - 1))}
        onAdd={() => onQuantityChange(1)}
      />
    )
  }

  const isAdded = quantity > 0
  return (
    <button
      type="button"
      onClick={() => onQuantityChange(isAdded ? 0 : 1)}
      aria-label={isAdded ? "Remove from cart" : "Add to cart"}
      className={cn(
        "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1",
        isAdded
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50",
      )}
    >
      {isAdded ? (
        <>
          <Check className="w-3.5 h-3.5" />
          Added
        </>
      ) : (
        <>
          <Plus className="w-3.5 h-3.5" />
          Add
        </>
      )}
    </button>
  )
}

interface CardListProps {
  products: ProductsPass[]
  getQuantity: (productId: string) => number
  onQuantityChange: (productId: string, qty: number) => void
  onSkip?: () => void
}

/* ── Variant: Default (current MerchSection — list with responsive layout) ── */

function MerchDefaultItem({
  product,
  quantity,
  onQuantityChange,
}: {
  product: ProductsPass
  quantity: number
  onQuantityChange: (qty: number) => void
}) {
  const hasQuantity = quantity > 0
  const hasDiscount =
    product.compare_price != null && product.compare_price > product.price

  return (
    <div
      className={cn(
        "p-4 transition-colors",
        hasQuantity ? "bg-blue-50/50" : "",
      )}
    >
      {/* Desktop layout */}
      <div className="hidden md:flex items-center gap-3">
        <MerchQtyControl
          product={product}
          quantity={quantity}
          onQuantityChange={onQuantityChange}
        />
        <div className="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className="object-cover"
            />
          ) : (
            <ShoppingBag className="w-6 h-6 text-gray-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 text-sm">{product.name}</h3>
          {product.description && (
            <ExpandableDescription
              text={product.description}
              clamp={2}
              className="text-xs text-gray-500 mt-0.5"
            />
          )}
        </div>
        <div className="text-right">
          {hasQuantity && quantity > 1 && (
            <p className="text-xs text-gray-400">
              {quantity} × {formatCurrency(product.price)}
            </p>
          )}
          <div className="flex items-center gap-1.5 justify-end">
            {hasDiscount && product.compare_price != null && (
              <span className="text-xs text-gray-400 line-through">
                {formatCurrency(
                  hasQuantity
                    ? product.compare_price * quantity
                    : product.compare_price,
                )}
              </span>
            )}
            <span
              className={cn(
                "font-semibold",
                hasQuantity
                  ? "text-blue-600"
                  : hasDiscount
                    ? "text-green-600"
                    : "text-gray-500",
              )}
            >
              {formatCurrency(
                hasQuantity ? product.price * quantity : product.price,
              )}
            </span>
          </div>
          {hasDiscount && !hasQuantity && product.compare_price != null && (
            <p className="text-xs text-green-600 font-medium">
              Save {formatCurrency(product.compare_price - product.price)}
            </p>
          )}
        </div>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden">
        <div className="flex gap-3 mb-3">
          <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt={product.name}
                fill
                className="object-cover"
              />
            ) : (
              <ShoppingBag className="w-7 h-7 text-gray-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm mb-0.5">
              {product.name}
            </h3>
            {product.description && (
              <ExpandableDescription
                text={product.description}
                clamp={2}
                className="text-xs text-gray-500"
              />
            )}
            {hasDiscount && product.compare_price != null && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs text-gray-400 line-through">
                  {formatCurrency(product.compare_price)}
                </span>
                <span className="text-xs text-green-600 font-medium">
                  {formatCurrency(product.price)} each
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <MerchQtyControl
            product={product}
            quantity={quantity}
            onQuantityChange={onQuantityChange}
          />
          <div className="text-right">
            {hasQuantity && quantity > 1 && (
              <p className="text-xs text-gray-400 mb-0.5">
                {quantity} × {formatCurrency(product.price)}
              </p>
            )}
            <span
              className={cn(
                "text-base font-bold",
                hasQuantity ? "text-blue-600" : "text-gray-500",
              )}
            >
              {formatCurrency(
                hasQuantity ? product.price * quantity : product.price,
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MerchDefault({
  products,
  getQuantity,
  onQuantityChange,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-4">
      <div className="bg-checkout-card-bg rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {products.map((product) => (
          <MerchDefaultItem
            key={product.id}
            product={product}
            quantity={getQuantity(product.id)}
            onQuantityChange={(qty) => onQuantityChange(product.id, qty)}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Variant: Grid (2-column image cards with quantity) ───── */

function MerchGrid({
  products,
  getQuantity,
  onQuantityChange,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((product) => {
          const qty = getQuantity(product.id)
          const hasQty = qty > 0
          const hasDiscount =
            product.compare_price != null &&
            product.compare_price > product.price

          return (
            <div
              key={product.id}
              className={cn(
                "rounded-2xl border overflow-hidden bg-checkout-card-bg transition-all",
                hasQty ? "border-blue-200" : "border-gray-200",
              )}
            >
              <div className="relative w-full aspect-square bg-gray-100 flex items-center justify-center">
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <ShoppingBag className="w-10 h-10 text-gray-300" />
                )}
              </div>
              <div className="p-3">
                <p className="font-semibold text-gray-900 text-sm leading-tight">
                  {product.name}
                </p>
                {product.description && (
                  <ExpandableDescription
                    text={product.description}
                    clamp={2}
                    className="text-xs text-gray-500 mt-0.5"
                  />
                )}
                <div className="flex items-center justify-between mt-2">
                  <div>
                    {hasDiscount && product.compare_price != null && (
                      <p className="text-xs text-gray-400 line-through">
                        {formatCurrency(product.compare_price)}
                      </p>
                    )}
                    <span
                      className={cn(
                        "font-bold text-sm",
                        hasQty
                          ? "text-blue-600"
                          : hasDiscount
                            ? "text-green-600"
                            : "text-gray-900",
                      )}
                    >
                      {formatCurrency(
                        hasQty ? product.price * qty : product.price,
                      )}
                    </span>
                  </div>
                  <MerchQtyControl
                    product={product}
                    quantity={qty}
                    onQuantityChange={(nextQty) =>
                      onQuantityChange(product.id, nextQty)
                    }
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Variant: Compact (horizontal rows with small image) ──── */

function MerchCompact({
  products,
  getQuantity,
  onQuantityChange,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-2">
      {products.map((product) => {
        const qty = getQuantity(product.id)
        const hasQty = qty > 0
        const hasDiscount =
          product.compare_price != null && product.compare_price > product.price

        return (
          <div
            key={product.id}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-3 transition-all",
              hasQty
                ? "border-blue-200 bg-blue-50/50"
                : "border-gray-200 hover:border-gray-300",
            )}
          >
            <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
              {product.image_url ? (
                <Image
                  src={product.image_url}
                  alt={product.name}
                  fill
                  className="object-cover"
                />
              ) : (
                <ShoppingBag className="w-5 h-5 text-gray-300" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-gray-900 truncate">
                {product.name}
              </p>
              <div>
                {hasDiscount && product.compare_price != null && (
                  <span className="text-xs text-gray-400 line-through mr-1">
                    {formatCurrency(product.compare_price)}
                  </span>
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    hasDiscount ? "text-green-600" : "text-gray-500",
                  )}
                >
                  {formatCurrency(product.price)} each
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <MerchQtyControl
                product={product}
                quantity={qty}
                onQuantityChange={(nextQty) =>
                  onQuantityChange(product.id, nextQty)
                }
              />
              <span
                className={cn(
                  "font-bold text-sm w-16 text-right",
                  hasQty ? "text-blue-600" : "text-gray-400",
                )}
              >
                {formatCurrency(hasQty ? product.price * qty : product.price)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Main export ──────────────────────────────────────────── */

export default function VariantMerchImage({
  products,
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, updateMerchQuantity } = useCheckout()

  const getQuantity = (productId: string): number => {
    const item = cart.merch.find((m) => m.productId === productId)
    return item?.quantity || 0
  }

  const handleQuantityChange = (productId: string, qty: number) => {
    updateMerchQuantity(productId, qty)
  }

  const handleSkip = () => {
    for (const item of cart.merch) {
      updateMerchQuantity(item.productId, 0)
    }
    onSkip?.()
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag className="w-12 h-12 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No Merchandise Available
        </h3>
        <p className="text-gray-500 max-w-md mb-6">
          Merchandise is not currently available for this event. You can
          continue to the next step.
        </p>
        <Button variant="outline" onClick={handleSkip}>
          Continue
        </Button>
      </div>
    )
  }

  const variant = (templateConfig?.variant as string) || "default"

  const cardProps: CardListProps = {
    products,
    getQuantity,
    onQuantityChange: handleQuantityChange,
    onSkip: handleSkip,
  }

  switch (variant) {
    case "compact":
      return <MerchCompact {...cardProps} />
    case "grid":
      return <MerchGrid {...cardProps} />
    default:
      return <MerchDefault {...cardProps} />
  }
}
