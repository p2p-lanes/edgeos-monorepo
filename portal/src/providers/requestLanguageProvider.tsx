"use client"

import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react"
import {
  resolveRequestLanguage,
  subscribeRequestLanguage,
} from "@/lib/language-storage"

const RequestLanguageContext = createContext<string | null>(null)
export function RequestLanguageProvider({
  language,
  children,
}: {
  language: string | null
  children: ReactNode
}) {
  return (
    <RequestLanguageContext.Provider value={language}>
      {children}
    </RequestLanguageContext.Provider>
  )
}
export function useRequestLanguage(fallback: string | null = null) {
  const initial = useContext(RequestLanguageContext) ?? fallback
  return useSyncExternalStore(
    subscribeRequestLanguage,
    () => resolveRequestLanguage() ?? initial,
    () => initial,
  )
}
