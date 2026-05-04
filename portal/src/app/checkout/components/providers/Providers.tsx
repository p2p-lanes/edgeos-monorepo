"use client"

import "@/i18n/config"
import type { ReactNode } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LanguageProvider } from "@/providers/languageProvider"
import QueryProvider from "@/providers/queryProvider"

interface ProvidersProps {
  children: ReactNode
}

const Providers = ({ children }: ProvidersProps) => {
  return (
    <QueryProvider>
      <LanguageProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </LanguageProvider>
    </QueryProvider>
  )
}

export default Providers
