"use client"

import "@/i18n/config"
import type { ReactNode } from "react"
import { LanguageProvider } from "@/providers/languageProvider"

const AuthLayout = ({ children }: { children: ReactNode }) => {
  return <LanguageProvider>{children}</LanguageProvider>
}

export default AuthLayout
