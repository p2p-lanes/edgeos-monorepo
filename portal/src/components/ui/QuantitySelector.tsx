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
export const resolveMaxQuantity = (product: {
  max_per_order?: number | null
  total_stock_remaining?: number | null
}): number => {
  const perOrder = product.max_per_order ?? Number.POSITIVE_INFINITY
  const stockRemaining =
    product.total_stock_remaining ?? Number.POSITIVE_INFINITY
  const cap = Math.min(perOrder, stockRemaining)
  return cap
}

/**
 * Resolves the effective stepper props for a row whose product may be
 * blocked (sold out, upcoming, ended, exclusivity).
 *
 * Constraint: blocked rows stay removable. Quantity already in the cart must
 * remain decrementable, so a blocked row with quantity > 0 keeps the stepper
 * enabled with `max` capped at the current quantity (increment self-disables
 * at max, decrement keeps working). Locked rows (e.g. already purchased) and
 * blocked rows with nothing in the cart stay fully disabled.
 */
export const resolveBlockedStepperProps = ({
  blocked,
  locked = false,
  quantity,
  max,
}: {
  blocked: boolean
  locked?: boolean
  quantity: number
  max: number
}): { max: number; disabled: boolean } => {
  if (locked) return { max, disabled: true }
  if (blocked) {
    return quantity > 0
      ? { max: quantity, disabled: false }
      : { max, disabled: true }
  }
  return { max, disabled: false }
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
  /**
   * Colour treatment for the empty-slot "+" tile.
   *  - `default` (legacy) — faint primary tile, primary icon.
   *  - `accent` — solid PRIMARY tile with the icon painted in the ACCENT
   *    colour at stroke-3. High-contrast CTA pop for use on light card
   *    surfaces where the legacy faint-primary tile gets lost.
   *
   * Adjustment buttons (+/-) are unchanged across both tones.
   */
  tone?: "default" | "accent"
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
  tone = "default",
}: QuantitySelectorProps) => {
  const stopPropagation = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
  }

  const isMinReached = value <= min
  const isMaxReached = value >= max

  // Empty-slot state: single "+" add button — filled tile CTA, sized larger
  // than the +/- adjustment buttons so it reads as the primary action.
  // Skip when max is 0 (sold out / unavailable) so we don't offer an action
  // the parent will reject.
  if (value === 0 && onAdd && !disabled && max > 0) {
    const isAccent = tone === "accent"
    const addClasses = cn(
      "transition-all duration-200 ease-out transform hover:scale-110 active:scale-95 flex items-center justify-center rounded-full shadow-sm",
      isAccent
        ? // Solid PRIMARY tile + PRIMARY-FOREGROUND icon — the theme's
          // guaranteed on-primary colour (same pairing as the Continue
          // button), so the "+" stays legible even when the accent is a
          // dark earthy tone that barely contrasts with primary. Falls back
          // to foreground/background if the popup set no theme.
          "bg-[color:var(--primary,theme(colors.foreground))] text-[color:var(--primary-foreground,theme(colors.background))] hover:brightness-110"
        : "hover:bg-primary/30 bg-primary/20 text-primary",
      ADD_BUTTON_SIZES[size],
    )
    return (
      <div className={cn("flex items-center", className)}>
        <button
          type="button"
          onClick={(e) => {
            stopPropagation(e)
            onAdd()
          }}
          className={addClasses}
          aria-label="Add item"
          tabIndex={0}
        >
          <Plus
            className={cn(
              ADD_ICON_SIZES[size],
              isAccent ? "stroke-[3]" : "stroke-[2.5]",
            )}
          />
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
