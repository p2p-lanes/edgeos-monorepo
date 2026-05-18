import * as React from "react"
import { cn } from "../utils"

/**
 * Visual tone for the error state. `destructive` (default) is the
 * historical red treatment used everywhere — keeps backwards
 * compatibility. `warning` paints an amber border instead; opt-in for
 * surfaces (e.g. the open-ticketing buyer step) that want validation
 * errors to read as "needs your attention" rather than a hard failure.
 */
export type ErrorTone = "destructive" | "warning"

const ERROR_BORDER_CLASS: Record<ErrorTone, string> = {
  destructive: "border-red-500",
  warning: "border-amber-500",
}

const inputVariants = {
  base:
    "flex h-9 w-full bg-transparent px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  outlined: {
    default:
      "shadow-sm rounded-md border border-input focus-visible:ring-1 focus-visible:ring-ring",
    disabled: "bg-muted border-muted-foreground/50",
  },
  standard: {
    default:
      "border-b focus-visible:border-b-2 focus-visible:border-primary",
    disabled: "",
  },
} as const

const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & {
    error?: string
    variant?: "outlined" | "standard"
    errorTone?: ErrorTone
  }
>(
  (
    {
      className,
      type,
      error,
      variant = "outlined",
      errorTone = "destructive",
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <input
        type={type}
        className={cn(
          inputVariants.base,
          inputVariants[variant].default,
          disabled && inputVariants[variant].disabled,
          error && ERROR_BORDER_CLASS[errorTone],
          className,
        )}
        disabled={disabled}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = "Input"

export { Input }
