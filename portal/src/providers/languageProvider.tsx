"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { SUPPORTED_LANGUAGES } from "@/i18n/config"
import { useCityProvider } from "./cityProvider"

const STORAGE_KEY = "portal_language"
const PORTAL_LANGUAGES = Object.keys(SUPPORTED_LANGUAGES)

interface LanguageContextValue {
  currentLanguage: string
  supportedLanguages: string[]
  setLanguage: (lang: string) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const { getCity } = useCityProvider()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const prevLanguageRef = useRef<string | null>(null)
  const city = getCity()

  const supportedLanguages = PORTAL_LANGUAGES
  const defaultLanguage = city?.default_language ?? "en"

  const [currentLanguage, setCurrentLanguage] = useState(() => {
    // Resolution order: URL param > localStorage > popup default
    // Don't validate against supportedLanguages here — popup data
    // may not be loaded yet. The sync effect validates once it loads.
    const urlLang = searchParams.get("lang")
    if (urlLang) return urlLang

    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return stored
    }

    return defaultLanguage
  })

  // Sync language when popup data loads or changes
  useEffect(() => {
    const urlLang = searchParams.get("lang")
    if (urlLang && supportedLanguages.includes(urlLang)) {
      setCurrentLanguage(urlLang)
      return
    }

    // Only validate once popup data has actually loaded
    if (city && !supportedLanguages.includes(currentLanguage)) {
      setCurrentLanguage(defaultLanguage)
    }
  }, [defaultLanguage, searchParams, currentLanguage, city])

  // Sync i18n instance, localStorage, and invalidate queries on language change
  useEffect(() => {
    if (i18n.language !== currentLanguage) {
      i18n.changeLanguage(currentLanguage)
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, currentLanguage)
    }
    document.documentElement.lang = currentLanguage

    // Invalidate all queries when language actually changes (not on mount)
    if (
      prevLanguageRef.current &&
      prevLanguageRef.current !== currentLanguage
    ) {
      queryClient.invalidateQueries()
    }
    prevLanguageRef.current = currentLanguage
  }, [currentLanguage, i18n, queryClient])

  const setLanguage = useCallback((lang: string) => {
    if (supportedLanguages.includes(lang)) {
      setCurrentLanguage(lang)
    }
  }, [])

  return (
    <LanguageContext.Provider
      value={{ currentLanguage, supportedLanguages, setLanguage }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}
