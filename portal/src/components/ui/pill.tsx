import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const pillVariants = cva(
  "inline-flex items-center font-medium border shadow-sm capitalize cursor-default",
  {
    variants: {
      variant: {
        pill: "rounded-full text-xs px-3 py-1.5 gap-1.5",
        chip: "rounded-md text-sm px-3 py-1.5 gap-2",
      },
      tone: {
        default: "bg-card",
        primary: "border-primary/40 bg-primary/10 text-primary",
      },
    },
    defaultVariants: {
      variant: "pill",
      tone: "default",
    },
  },
)

export interface PillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof pillVariants> {
  icon?: React.ReactNode
  children: React.ReactNode
}

export function Pill({
  className,
  variant,
  tone,
  icon,
  children,
  ...props
}: PillProps) {
  return (
    <span className={cn(pillVariants({ variant, tone }), className)} {...props}>
      {icon}
      {children}
    </span>
  )
}
