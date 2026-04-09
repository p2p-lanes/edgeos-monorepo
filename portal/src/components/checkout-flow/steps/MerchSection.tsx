"use client"

import { Info, Minus, Plus, ShoppingBag, X } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { Button } from "@/components/ui/button"
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
          Merchandise is not currently available for this event. You can
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
  const [activeTooltip, setActiveTooltip] = useState(false)
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
        <QuantityControls
          quantity={quantity}
          onIncrement={() => onQuantityChange(quantity + 1)}
          onDecrement={() => onQuantityChange(Math.max(0, quantity - 1))}
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
          <div className="flex items-center gap-1">
            <h3 className="font-medium text-gray-900 text-sm">
              {product.name}
            </h3>
            {product.description && (
              <Tooltip
                content={product.description}
                isActive={activeTooltip}
                onToggle={() => setActiveTooltip(!activeTooltip)}
                onClose={() => setActiveTooltip(false)}
              />
            )}
          </div>
          {product.description && (
            <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">
              {product.description}
            </p>
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
            <div className="flex items-center gap-1 mb-0.5">
              <h3 className="font-semibold text-gray-900 text-sm">
                {product.name}
              </h3>
              {product.description && (
                <Tooltip
                  content={product.description}
                  isActive={activeTooltip}
                  onToggle={() => setActiveTooltip(!activeTooltip)}
                  onClose={() => setActiveTooltip(false)}
                />
              )}
            </div>
            <p className="text-xs text-gray-500 line-clamp-2">
              {product.description}
            </p>
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
          <QuantityControls
            quantity={quantity}
            onIncrement={() => onQuantityChange(quantity + 1)}
            onDecrement={() => onQuantityChange(Math.max(0, quantity - 1))}
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

interface QuantityControlsProps {
  quantity: number
  onIncrement: () => void
  onDecrement: () => void
}

function QuantityControls({
  quantity,
  onIncrement,
  onDecrement,
}: QuantityControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onDecrement}
        disabled={quantity === 0}
        aria-label="Decrease quantity"
        className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center transition-all",
          quantity === 0
            ? "text-gray-300 cursor-not-allowed"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
        )}
      >
        <Minus className="w-4 h-4" />
      </button>
      <span
        className={cn(
          "w-6 text-center font-semibold text-sm",
          quantity > 0 ? "text-blue-600" : "text-gray-400",
        )}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        aria-label="Increase quantity"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

interface TooltipProps {
  content: string
  isActive: boolean
  onToggle: () => void
  onClose: () => void
}

function Tooltip({ content, isActive, onToggle, onClose }: TooltipProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="More info"
      >
        <Info className="w-4 h-4" />
      </button>

      {isActive && (
        <>
          <button
            type="button"
            aria-label="Close tooltip"
            className="fixed inset-0 z-40 sm:hidden cursor-default"
            onClick={onClose}
          />
          <div className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tooltip"
              className="absolute top-1 right-1 p-1 text-gray-400 hover:text-white sm:hidden"
            >
              <X className="w-3 h-3" />
            </button>
            <p className="leading-relaxed pr-4 sm:pr-0">{content}</p>
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 rotate-45" />
          </div>
        </>
      )}
    </div>
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
