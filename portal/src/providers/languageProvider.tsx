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
const DEFAULT_LANGUAGE = "en"

// Match navigator.languages (e.g. "es-AR", "zh-Hant") against supported locales.
// Prefer exact match, then fall back to the base subtag ("es-AR" → "es").
function detectBrowserLanguage(): string | null {
  if (typeof navigator === "undefined") return null
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const raw of candidates) {
    if (!raw) continue
    const lower = raw.toLowerCase()
    if (PORTAL_LANGUAGES.includes(lower)) return lower
    const base = lower.split("-")[0]
    if (PORTAL_LANGUAGES.includes(base)) return base
  }
  return null
}

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

  const [currentLanguage, setCurrentLanguage] = useState(() => {
    // Resolution order: URL param > localStorage > navigator > default
    const urlLang = searchParams.get("lang")
    if (urlLang) return urlLang

    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return stored
    }

    return detectBrowserLanguage() ?? DEFAULT_LANGUAGE
  })

  // Sync language when popup data loads or URL param changes
  useEffect(() => {
    const urlLang = searchParams.get("lang")
    if (urlLang && supportedLanguages.includes(urlLang)) {
      setCurrentLanguage(urlLang)
      return
    }

    // Validate current selection against supported list once popup loads
    if (city && !supportedLanguages.includes(currentLanguage)) {
      setCurrentLanguage(detectBrowserLanguage() ?? DEFAULT_LANGUAGE)
    }
  }, [searchParams, currentLanguage, city])

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
