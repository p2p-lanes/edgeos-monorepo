"use client"

import { useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
import {
  LANGUAGE_STORAGE_KEY,
  setActiveRequestLanguage,
} from "@/lib/language-storage"
import { CityContext } from "./cityProvider"

// Bumped from "portal_language": prior versions auto-wrote on every render,
// leaving stale "en" values that override the popup default_language.
const STORAGE_KEY = LANGUAGE_STORAGE_KEY
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
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const prevLanguageRef = useRef<string | null>(null)
  // Holds a language chosen via setLanguage while its ?lang navigation is
  // still in flight, so the resolver effect doesn't bounce back to the old
  // URL value before the navigation lands.
  const pendingLanguageRef = useRef<string | null>(null)
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
    // setLanguage applies the choice immediately and then syncs ?lang. Until
    // that navigation lands the URL still carries the previous language, so
    // ignore it while a pending choice is outstanding — otherwise the resolver
    // reverts to the old value for the duration of the navigation round-trip.
    if (pendingLanguageRef.current) {
      if (urlLanguage === pendingLanguageRef.current) {
        pendingLanguageRef.current = null
      } else {
        return
      }
    }
    // An explicit ?lang= is a user choice made on the referring site (same
    // class as the manual selector), so persist it: the language must survive
    // in-session navigations that drop the query param, e.g. returning from
    // the payment provider after a cancel.
    if (urlLanguage && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, urlLanguage)
    }
    const storedLanguage =
      typeof window === "undefined"
        ? null
        : resolveLanguageCandidate(
            localStorage.getItem(STORAGE_KEY),
            supportedLanguages,
          )
    const browserLanguage = detectBrowserLanguage(supportedLanguages)
    // Popup default beats browser locale: organizer intent over visitor OS.
    const nextLanguage =
      urlLanguage ??
      storedLanguage ??
      defaultLanguage ??
      browserLanguage ??
      DEFAULT_LANGUAGE

    if (nextLanguage !== currentLanguage) {
      setCurrentLanguage(nextLanguage)
    }
  }, [searchParams, supportedLanguages, defaultLanguage, currentLanguage])

  // localStorage is written only on explicit signals — setLanguage (manual
  // choice) and an incoming ?lang= param — never by auto-resolve, to avoid
  // clobbering the popup default and bouncing back on next render.
  useEffect(() => {
    if (i18n.language !== currentLanguage) {
      i18n.changeLanguage(currentLanguage)
    }
    document.documentElement.lang = currentLanguage
    // Mirror the on-screen language for the API client interceptor before the
    // refetch below fires, so dynamic content reloads in the new language even
    // though the ?lang navigation is still in flight.
    setActiveRequestLanguage(currentLanguage)

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
    if (!resolvedLanguage) return
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, resolvedLanguage)
    }
    // Apply immediately so the UI switches on click instead of waiting for the
    // navigation round-trip. The ?lang write below only keeps the choice
    // forwardable in the URL and persistent across navigations; pendingLanguageRef
    // stops the resolver effect from reverting to the stale ?lang until it lands.
    pendingLanguageRef.current = resolvedLanguage
    setCurrentLanguage(resolvedLanguage)
    const params = new URLSearchParams(searchParams.toString())
    params.set("lang", resolvedLanguage)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
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
