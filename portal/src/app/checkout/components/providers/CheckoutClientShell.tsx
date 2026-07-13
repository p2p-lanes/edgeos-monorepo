"use client"

import "@/i18n/config"
import type { ReactNode } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"

interface CheckoutClientShellProps {
  children: ReactNode
}

export default function CheckoutClientShell({
  children,
}: CheckoutClientShellProps) {
  return <TooltipProvider>{children}</TooltipProvider>
}
