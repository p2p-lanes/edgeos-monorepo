"use client"

import { Heart } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import {
  formatCurrency,
  PATRON_MINIMUM,
  PATRON_PRESETS,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

function parseTemplateConfig(templateConfig?: Record<string, unknown> | null) {
  const presets =
    templateConfig &&
    Array.isArray(templateConfig.presets) &&
    templateConfig.presets.every((v: unknown) => typeof v === "number" && v > 0)
      ? (templateConfig.presets as number[])
      : PATRON_PRESETS
  const allowCustom =
    templateConfig && typeof templateConfig.allow_custom === "boolean"
      ? templateConfig.allow_custom
      : true
  const minimum =
    templateConfig &&
    typeof templateConfig.minimum === "number" &&
    templateConfig.minimum > 0
      ? templateConfig.minimum
      : PATRON_MINIMUM
  return { presets, allowCustom, minimum }
}

export default function VariantPatronPreset({
  products,
  stepType,
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []
  const { presets, allowCustom, minimum } = parseTemplateConfig(templateConfig)

  const product = products[0]
  const currentItem = items[0]
  const currentAmount = currentItem?.quantity ?? 0

  const [isCustom, setIsCustom] = useState(
    currentAmount > 0 && !presets.includes(currentAmount),
  )
  const [customValue, setCustomValue] = useState(
    currentAmount > 0 && !presets.includes(currentAmount)
      ? currentAmount.toString()
      : "",
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
    if (!Number.isNaN(num) && num >= minimum) {
      setAmount(num)
    } else {
      removeDynamicItem(stepType, product?.id ?? "")
    }
  }

  const variant = (templateConfig?.variant as string) || "default"

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No contribution options available.</p>
        <Button variant="outline" onClick={onSkip}>
          Continue
        </Button>
      </div>
    )
  }

  const sharedProps: PatronLayoutProps = {
    product,
    presets,
    allowCustom,
    minimum,
    currentAmount,
    isCustom,
    customValue,
    handlePreset,
    handleCustomChange,
    onRemove: () => {
      setIsCustom(false)
      setCustomValue("")
      removeDynamicItem(stepType, product.id)
    },
    onSkip,
  }

  switch (variant) {
    case "compact":
      return <PatronCompact {...sharedProps} />
    case "grid":
      return <PatronGrid {...sharedProps} />
    default:
      return <PatronDefault {...sharedProps} />
  }
}

interface PatronLayoutProps {
  product: ProductsPass
  presets: number[]
  allowCustom: boolean
  minimum: number
  currentAmount: number
  isCustom: boolean
  customValue: string
  handlePreset: (amount: number) => void
  handleCustomChange: (value: string) => void
  onRemove: () => void
  onSkip?: () => void
}

function PatronDefault({
  product,
  presets,
  allowCustom,
  minimum,
  currentAmount,
  isCustom,
  customValue,
  handlePreset,
  handleCustomChange,
  onRemove,
  onSkip,
}: PatronLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-5">
        {product.description && (
          <p className="text-sm text-gray-600 mb-4">{product.description}</p>
        )}

        <div className="flex gap-2 mb-3">
          {presets.map((amount) => {
            const selected = currentAmount === amount && !isCustom
            return (
              <button
                key={amount}
                type="button"
                onClick={() => handlePreset(amount)}
                className={cn(
                  "flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all",
                  selected
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                )}
              >
                {formatCurrency(amount)}
              </button>
            )
          })}
        </div>

        {allowCustom && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Custom:</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder={minimum.toLocaleString()}
                aria-label="Custom amount"
                className={cn(
                  "w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent",
                  isCustom &&
                    customValue &&
                    Number.parseInt(customValue, 10) >= minimum
                    ? "border-green-400 bg-green-50 focus:ring-green-400"
                    : "border-gray-200 focus:ring-amber-400",
                )}
              />
            </div>
            <span className="text-xs text-gray-400">
              Min {formatCurrency(minimum)}
            </span>
          </div>
        )}

        {currentAmount > 0 && (
          <div className="pt-3 text-center">
            <button
              type="button"
              onClick={onRemove}
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

function PatronCompact({
  product,
  presets,
  allowCustom,
  minimum,
  currentAmount,
  isCustom,
  customValue,
  handlePreset,
  handleCustomChange,
  onRemove,
  onSkip,
}: PatronLayoutProps) {
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-3">
        {product.description && (
          <p className="text-xs text-gray-500 mb-3">{product.description}</p>
        )}

        <div className="flex gap-1.5 mb-2">
          {presets.map((amount) => {
            const selected = currentAmount === amount && !isCustom
            return (
              <button
                key={amount}
                type="button"
                onClick={() => handlePreset(amount)}
                className={cn(
                  "flex-1 py-1.5 rounded-md font-medium text-xs transition-all",
                  selected
                    ? "bg-gray-900 text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100",
                )}
              >
                {formatCurrency(amount)}
              </button>
            )
          })}
        </div>

        {allowCustom && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder={`Custom (min ${formatCurrency(minimum)})`}
                aria-label="Custom amount"
                className={cn(
                  "w-full pl-6 pr-2 py-1.5 border rounded-md text-xs focus:outline-none focus:ring-1 focus:border-transparent",
                  isCustom &&
                    customValue &&
                    Number.parseInt(customValue, 10) >= minimum
                    ? "border-green-400 bg-green-50 focus:ring-green-400"
                    : "border-gray-200 focus:ring-amber-400",
                )}
              />
            </div>
          </div>
        )}

        {currentAmount > 0 && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={onRemove}
              className="text-gray-400 hover:text-gray-600 text-[11px] transition-colors"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="text-center py-1">
        <button
          type="button"
          onClick={onSkip}
          className="text-gray-500 hover:text-gray-700 underline text-xs transition-colors"
        >
          Skip this step
        </button>
      </div>
    </div>
  )
}

function PatronGrid({
  product,
  presets,
  allowCustom,
  minimum,
  currentAmount,
  isCustom,
  customValue,
  handlePreset,
  handleCustomChange,
  onRemove,
  onSkip,
}: PatronLayoutProps) {
  return (
    <div className="space-y-4">
      {product.description && (
        <p className="text-sm text-gray-600">{product.description}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {presets.map((amount) => {
          const selected = currentAmount === amount && !isCustom
          return (
            <button
              key={amount}
              type="button"
              onClick={() => handlePreset(amount)}
              className={cn(
                "flex flex-col items-center justify-center rounded-2xl border-2 p-5 transition-all",
                selected
                  ? "border-gray-900 bg-gray-900 text-white shadow-md"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:shadow-sm",
              )}
            >
              <Heart
                className={cn(
                  "w-5 h-5 mb-2",
                  selected ? "text-white" : "text-gray-300",
                )}
              />
              <span className="text-lg font-bold">
                {formatCurrency(amount)}
              </span>
            </button>
          )
        })}

        {allowCustom && (
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl border-2 p-5 transition-all",
              isCustom &&
                customValue &&
                Number.parseInt(customValue, 10) >= minimum
                ? "border-green-400 bg-green-50"
                : "border-gray-200 bg-white",
            )}
          >
            <Heart className="w-5 h-5 mb-2 text-gray-300" />
            <div className="relative w-full max-w-[120px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder={minimum.toLocaleString()}
                aria-label="Custom amount"
                className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg text-center text-sm font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
            <span className="text-[10px] text-gray-400 mt-1">
              Min {formatCurrency(minimum)}
            </span>
          </div>
        )}
      </div>

      {currentAmount > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-gray-600 text-xs transition-colors"
          >
            Remove contribution
          </button>
        </div>
      )}

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
