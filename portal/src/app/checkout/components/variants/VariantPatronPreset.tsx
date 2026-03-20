"use client"

import { Heart } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency, PATRON_MINIMUM, PATRON_PRESETS } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
}

export default function VariantPatronPreset({ products, stepType, onSkip }: VariantProps) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []

  const product = products[0]
  const currentItem = items[0]
  const currentAmount = currentItem?.quantity ?? 0

  const [isCustom, setIsCustom] = useState(
    currentAmount > 0 && !PATRON_PRESETS.includes(currentAmount)
  )
  const [customValue, setCustomValue] = useState(
    currentAmount > 0 && !PATRON_PRESETS.includes(currentAmount)
      ? currentAmount.toString()
      : ""
  )

  const setAmount = (amount: number) => {
    if (!product) return
    if (amount <= 0) {
      removeDynamicItem(stepType, product.id)
      return
    }
    addDynamicItem(stepType, {
      productId: product.id,
      product,
      quantity: amount,
      price: amount,
      stepType,
    })
  }

  const handlePreset = (amount: number) => {
    const alreadySelected = currentAmount === amount && !isCustom
    setIsCustom(false)
    setCustomValue("")
    if (alreadySelected) {
      removeDynamicItem(stepType, product?.id ?? "")
    } else {
      setAmount(amount)
    }
  }

  const handleCustomChange = (value: string) => {
    setIsCustom(true)
    setCustomValue(value)
    const num = Number.parseInt(value.replace(/,/g, ""), 10)
    if (!Number.isNaN(num) && num >= PATRON_MINIMUM) {
      setAmount(num)
    } else {
      removeDynamicItem(stepType, product?.id ?? "")
    }
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No contribution options available.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-5">
        {product.description && (
          <p className="text-sm text-gray-600 mb-4">{product.description}</p>
        )}

        <div className="flex gap-2 mb-3">
          {PATRON_PRESETS.map((amount) => {
            const selected = currentAmount === amount && !isCustom
            return (
              <button
                key={amount}
                type="button"
                onClick={() => handlePreset(amount)}
                className={cn(
                  "flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all",
                  selected ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                {formatCurrency(amount)}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Custom:</span>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              inputMode="numeric"
              value={customValue}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder={PATRON_MINIMUM.toLocaleString()}
              aria-label="Custom amount"
              className={cn(
                "w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent",
                isCustom && customValue && Number.parseInt(customValue, 10) >= PATRON_MINIMUM
                  ? "border-green-400 bg-green-50 focus:ring-green-400"
                  : "border-gray-200 focus:ring-amber-400"
              )}
            />
          </div>
          <span className="text-xs text-gray-400">Min {formatCurrency(PATRON_MINIMUM)}</span>
        </div>

        {currentAmount > 0 && (
          <div className="pt-3 text-center">
            <button
              type="button"
              onClick={() => { setIsCustom(false); setCustomValue(""); removeDynamicItem(stepType, product.id) }}
              className="text-gray-400 hover:text-gray-600 text-xs transition-colors"
            >
              Remove contribution
            </button>
          </div>
        )}
      </div>

      <div className="text-center py-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-gray-500 hover:text-gray-700 underline text-sm transition-colors"
        >
          Skip this step
        </button>
      </div>
    </div>
  )
}
