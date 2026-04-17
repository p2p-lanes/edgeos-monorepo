"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { SUPPORTED_LANGUAGES } from "@/i18n/config"
import { CityContext } from "./cityProvider"

const STORAGE_KEY = "portal_language"
const PORTAL_LANGUAGES = Object.keys(SUPPORTED_LANGUAGES)
const DEFAULT_LANGUAGE = "en"

// Match navigator.languages (e.g. "es-AR", "zh-Hant") against supported locales.
// Prefer exact match, then fall back to the base subtag ("es-AR" → "es").
function resolveLanguageCandidate(
  rawLanguage: string | null | undefined,
  allowedLanguages: string[],
): string | null {
  if (!rawLanguage) return null

  const normalizedLanguage = rawLanguage.toLowerCase()
  if (allowedLanguages.includes(normalizedLanguage)) {
    return normalizedLanguage
  }

  const baseLanguage = normalizedLanguage.split("-")[0]
  if (allowedLanguages.includes(baseLanguage)) {
    return baseLanguage
  }

  return null
}

function detectBrowserLanguage(allowedLanguages: string[]): string | null {
  if (typeof navigator === "undefined") return null
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const raw of candidates) {
    const resolvedLanguage = resolveLanguageCandidate(raw, allowedLanguages)
    if (resolvedLanguage) return resolvedLanguage
  }
  return null
}

function getAllowedLanguages(
  popupSupportedLanguages: string[] | null | undefined,
  popupDefaultLanguage: string | null | undefined,
): string[] {
  const normalizedLanguages = (popupSupportedLanguages ?? [])
    .map((language) => resolveLanguageCandidate(language, PORTAL_LANGUAGES))
    .filter((language): language is string => language !== null)

  if (normalizedLanguages.length > 0) {
    return Array.from(new Set(normalizedLanguages))
  }

  const resolvedDefaultLanguage = resolveLanguageCandidate(
    popupDefaultLanguage,
    PORTAL_LANGUAGES,
  )

  return [resolvedDefaultLanguage ?? DEFAULT_LANGUAGE]
}

interface LanguageContextValue {
  currentLanguage: string
  supportedLanguages: string[]
  setLanguage: (lang: string) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const cityContext = useContext(CityContext)
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const prevLanguageRef = useRef<string | null>(null)
  const popup = cityContext?.getCity() ?? null
  const supportedLanguages = getAllowedLanguages(
    popup?.supported_languages,
    popup?.default_language,
  )
  const defaultLanguage = resolveLanguageCandidate(
    popup?.default_language,
    supportedLanguages,
  )
  const [currentLanguage, setCurrentLanguage] = useState(DEFAULT_LANGUAGE)

  useEffect(() => {
    const urlLanguage = resolveLanguageCandidate(
      searchParams.get("lang"),
      supportedLanguages,
    )
    const storedLanguage =
      typeof window === "undefined"
        ? null
        : resolveLanguageCandidate(
            localStorage.getItem(STORAGE_KEY),
            supportedLanguages,
          )
    const browserLanguage = detectBrowserLanguage(supportedLanguages)
    const nextLanguage =
      urlLanguage ??
      storedLanguage ??
      browserLanguage ??
      defaultLanguage ??
      DEFAULT_LANGUAGE

    if (nextLanguage !== currentLanguage) {
      setCurrentLanguage(nextLanguage)
    }
  }, [searchParams, supportedLanguages, defaultLanguage, currentLanguage])

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

  const setLanguage = (lang: string) => {
    const resolvedLanguage = resolveLanguageCandidate(lang, supportedLanguages)
    if (resolvedLanguage) {
      setCurrentLanguage(resolvedLanguage)
    }
  }

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
