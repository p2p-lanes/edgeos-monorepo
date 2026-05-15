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
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, setPatronAmount, clearPatron } = useCheckout()
  const { presets, allowCustom, minimum } = parseTemplateConfig(templateConfig)

  const product = products[0]
  const currentAmount = cart.patron?.amount ?? 0

  const [isCustom, setIsCustom] = useState(
    currentAmount > 0 && !presets.includes(currentAmount),
  )
  const [customValue, setCustomValue] = useState(
    currentAmount > 0 && !presets.includes(currentAmount)
      ? currentAmount.toString()
      : "",
  )

  const setAmount = (amount: number, isCustomAmount = false) => {
    if (!product) return
    if (amount <= 0) {
      clearPatron()
      return
    }
    setPatronAmount(product.id, amount, isCustomAmount)
  }

  const handlePreset = (amount: number) => {
    const alreadySelected = currentAmount === amount && !isCustom
    setIsCustom(false)
    setCustomValue("")
    if (alreadySelected) {
      clearPatron()
    } else {
      setAmount(amount, false)
    }
  }

  const handleCustomChange = (value: string) => {
    setIsCustom(true)
    setCustomValue(value)
    const num = Number.parseInt(value.replace(/,/g, ""), 10)
    if (!Number.isNaN(num) && num >= minimum) {
      setAmount(num, true)
    } else {
      clearPatron()
    }
  }

  const variant = (templateConfig?.variant as string) || "default"

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-6">
          No contribution options available.
        </p>
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
      clearPatron()
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

function ProductDescription({
  description,
  className,
  gap = "space-y-3",
}: {
  description: string
  className: string
  gap?: string
}) {
  const paragraphs = description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return (
    <div className={gap}>
      {paragraphs.map((para, idx) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: stable paragraph order
          key={idx}
          className={cn(className, "whitespace-pre-line")}
        >
          {para}
        </p>
      ))}
    </div>
  )
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
}: PatronLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden p-5">
        {product.description && (
          <div className="mb-4">
            <ProductDescription
              description={product.description}
              className="text-sm text-muted-foreground leading-relaxed"
            />
          </div>
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
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground hover:bg-muted/80",
                )}
              >
                {formatCurrency(amount)}
              </button>
            )
          })}
        </div>

        {allowCustom && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Custom:</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
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
                    : "border-border focus:ring-amber-400",
                )}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Min {formatCurrency(minimum)}
            </span>
          </div>
        )}

        {currentAmount > 0 && (
          <div className="pt-3 text-center">
            <button
              type="button"
              onClick={onRemove}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Remove contribution
            </button>
          </div>
        )}
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
}: PatronLayoutProps) {
  return (
    <div className="space-y-3">
      <div className="bg-checkout-card-bg rounded-xl border border-border p-3">
        {product.description && (
          <div className="mb-3">
            <ProductDescription
              description={product.description}
              className="text-xs text-muted-foreground leading-relaxed"
              gap="space-y-2"
            />
          </div>
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
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
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
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
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
                    : "border-border focus:ring-amber-400",
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
              className="text-muted-foreground hover:text-foreground text-[11px] transition-colors"
            >
              Remove
            </button>
          </div>
        )}
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
}: PatronLayoutProps) {
  return (
    <div className="space-y-4">
      {product.description && (
        <ProductDescription
          description={product.description}
          className="text-sm text-muted-foreground leading-relaxed"
        />
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
                  ? "border-foreground bg-foreground text-background shadow-md"
                  : "border-border bg-checkout-card-bg text-foreground hover:border-muted-foreground/60 hover:shadow-sm",
              )}
            >
              <Heart
                className={cn(
                  "w-5 h-5 mb-2",
                  selected ? "text-background" : "text-muted-foreground",
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
                : "border-border bg-checkout-card-bg",
            )}
          >
            <Heart className="w-5 h-5 mb-2 text-muted-foreground" />
            <div className="relative w-full max-w-[120px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder={minimum.toLocaleString()}
                aria-label="Custom amount"
                className="w-full pl-7 pr-2 py-1.5 border border-border rounded-lg text-center text-sm font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
            <span className="text-[10px] text-muted-foreground mt-1">
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
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Remove contribution
          </button>
        </div>
      )}
    </div>
  )
}
