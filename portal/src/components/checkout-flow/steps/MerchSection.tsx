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

interface MerchSectionProps {
  onSkip?: () => void
}

export default function MerchSection({ onSkip }: MerchSectionProps) {
  const { merchProducts, cart, updateMerchQuantity } = useCheckout()

  const getQuantity = (productId: string): number => {
    const item = cart.merch.find((m) => m.productId === productId)
    return item?.quantity || 0
  }

  const handleSkip = () => {
    for (const item of cart.merch) {
      updateMerchQuantity(item.productId, 0)
    }
    onSkip?.()
  }

  if (merchProducts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag className="w-12 h-12 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No Merchandise Available
        </h3>
        <p className="text-gray-500 max-w-md mb-6">
          Merchandise is not currently available for this pop-up. You can
          continue to the next step.
        </p>
        <Button variant="outline" onClick={handleSkip}>
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {merchProducts.map((product) => (
          <MerchItem
            key={product.id}
            product={product}
            quantity={getQuantity(product.id)}
            onQuantityChange={(qty) => updateMerchQuantity(product.id, qty)}
          />
        ))}
      </div>
    </div>
  )
}

interface MerchItemProps {
  product: ProductsPass
  quantity: number
  onQuantityChange: (quantity: number) => void
}

function MerchItem({ product, quantity, onQuantityChange }: MerchItemProps) {
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
        <PriceDisplay
          price={product.price}
          comparePrice={
            hasDiscount ? (product.compare_price ?? undefined) : undefined
          }
          quantity={quantity}
        />
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

interface MerchQtyControlProps {
  product: ProductsPass
  quantity: number
  onQuantityChange: (qty: number) => void
}

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

interface PriceDisplayProps {
  price: number
  comparePrice?: number
  quantity: number
}

function PriceDisplay({ price, comparePrice, quantity }: PriceDisplayProps) {
  const hasDiscount = comparePrice != null && comparePrice > price
  const hasQuantity = quantity > 0
  const displayPrice = hasQuantity ? price * quantity : price
  const displayOriginal =
    hasQuantity && comparePrice ? comparePrice * quantity : comparePrice

  return (
    <div className="text-right">
      {hasQuantity && quantity > 1 && (
        <p className="text-xs text-gray-400">
          {quantity} × {formatCurrency(price)}
        </p>
      )}
      <div className="flex items-center gap-1.5 justify-end">
        {hasDiscount && displayOriginal != null && (
          <span className="text-xs text-gray-400 line-through">
            {formatCurrency(displayOriginal)}
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
          {formatCurrency(displayPrice)}
        </span>
      </div>
      {hasDiscount && !hasQuantity && comparePrice != null && (
        <p className="text-xs text-green-600 font-medium">
          Save {formatCurrency(comparePrice - price)}
        </p>
      )}
    </div>
  )
}
