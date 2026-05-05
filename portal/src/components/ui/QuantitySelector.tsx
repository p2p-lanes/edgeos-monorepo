"use client"

import { Minus, Plus } from "lucide-react"
import type { MouseEvent } from "react"
import { cn } from "@/lib/utils"

/**
 * Returns true when a product should render a +/- stepper instead of a toggle.
 * Rule: `max_per_order == null` (unlimited) OR `max_per_order > 1`.
 */
export const supportsQuantitySelector = (
  maxPerOrder: number | null | undefined,
): boolean => maxPerOrder == null || maxPerOrder > 1

/**
 * Resolves the effective max allowed for a product's stepper.
 *
 * Effective cap = min(max_per_order, total_stock_remaining), respecting NULL = unlimited.
 *
 * - If both are NULL, unlimited (POSITIVE_INFINITY) — unless dayPassFallbackToDateRange
 *   is true and the product has a date range, in which case the date-range cap applies.
 * - Backend remains source of truth; this is a UX cap only.
 */
export const resolveMaxQuantity = (
  product: {
    max_per_order?: number | null
    total_stock_remaining?: number | null
    start_date?: string | null
    end_date?: string | null
  },
  opts?: { dayPassFallbackToDateRange?: boolean },
): number => {
  const perOrder = product.max_per_order ?? Number.POSITIVE_INFINITY
  const stockRemaining = product.total_stock_remaining ?? Number.POSITIVE_INFINITY
  let cap = Math.min(perOrder, stockRemaining)

  if (
    cap === Number.POSITIVE_INFINITY &&
    opts?.dayPassFallbackToDateRange &&
    product.start_date &&
    product.end_date
  ) {
    const start = new Date(product.start_date)
    const end = new Date(product.end_date)
    const diff = Math.abs(end.getTime() - start.getTime())
    cap = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1
  }

  return cap
}

interface QuantitySelectorProps {
  value: number
  max: number
  min?: number
  disabled?: boolean
  onIncrement: () => void
  onDecrement: () => void
  /**
   * If provided AND `value === 0` AND not disabled, renders a single "+" add button
   * (used by ProductDay's empty-slot state). Falls back to `onIncrement` otherwise.
   */
  onAdd?: () => void
  size?: "sm" | "md"
  className?: string
}

const BUTTON_SIZES: Record<
  NonNullable<QuantitySelectorProps["size"]>,
  string
> = {
  sm: "w-5 h-5",
  md: "w-6 h-6",
}

const ICON_SIZES: Record<NonNullable<QuantitySelectorProps["size"]>, string> = {
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
}

// Empty-slot "Add" is the primary CTA for selecting a product, so it's
// rendered larger and as a filled brand tile to stand out against the +/-
// adjustment buttons below.
const ADD_BUTTON_SIZES: Record<
  NonNullable<QuantitySelectorProps["size"]>,
  string
> = {
  sm: "w-7 h-7",
  md: "w-8 h-8",
}

const ADD_ICON_SIZES: Record<
  NonNullable<QuantitySelectorProps["size"]>,
  string
> = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
}

const VALUE_SIZES: Record<
  NonNullable<QuantitySelectorProps["size"]>,
  string
> = {
  sm: "w-5 text-xs",
  md: "w-6 text-sm",
}

/**
 * Shared stepper used across the passes/checkout flows.
 * Presentational only — parent owns state and computes min/max.
 */
const QuantitySelector = ({
  value,
  max,
  min = 0,
  disabled = false,
  onIncrement,
  onDecrement,
  onAdd,
  size = "md",
  className,
}: QuantitySelectorProps) => {
  const stopPropagation = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
  }

  const isMinReached = value <= min
  const isMaxReached = value >= max

  // Empty-slot state: single "+" add button — filled tile CTA, sized larger
  // than the +/- adjustment buttons so it reads as the primary action.
  if (value === 0 && onAdd && !disabled) {
    return (
      <div className={cn("flex items-center", className)}>
        <button
          type="button"
          onClick={(e) => {
            stopPropagation(e)
            onAdd()
          }}
          className={cn(
            "transition-all duration-200 ease-out transform hover:scale-110 active:scale-95 hover:bg-primary/30 flex items-center justify-center rounded-full bg-primary/20 text-primary shadow-sm",
            ADD_BUTTON_SIZES[size],
          )}
          aria-label="Add item"
          tabIndex={0}
        >
          <Plus className={cn(ADD_ICON_SIZES[size], "stroke-[2.5]")} />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center relative overflow-hidden animate-fade-in-right",
        className,
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          stopPropagation(e)
          onDecrement()
        }}
        className={cn(
          "transition-all duration-300 ease-in-out transform hover:scale-110 flex items-center justify-center rounded",
          BUTTON_SIZES[size],
          (disabled || isMinReached) && "opacity-50 cursor-not-allowed",
        )}
        disabled={disabled || isMinReached}
        aria-label="Decrease quantity"
        tabIndex={0}
      >
        <Minus className={ICON_SIZES[size]} />
      </button>
      <span
        className={cn(
          "transition-all duration-300 ease-in-out text-center font-medium",
          VALUE_SIZES[size],
        )}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={(e) => {
          stopPropagation(e)
          onIncrement()
        }}
        className={cn(
          "transition-all duration-300 ease-in-out transform hover:scale-110 flex items-center justify-center rounded",
          BUTTON_SIZES[size],
          (disabled || isMaxReached) && "opacity-50 cursor-not-allowed",
        )}
        disabled={disabled || isMaxReached}
        aria-label="Increase quantity"
        tabIndex={0}
      >
        <Plus className={ICON_SIZES[size]} />
      </button>
    </div>
  )
}

export default QuantitySelector
