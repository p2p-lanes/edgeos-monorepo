"use client"

import { createContext, useContext, useEffect, useState } from "react"

export type DesignVariant = "snap"
export type PassesVariant = "stacked" | "tabs" | "compact" | "accordion"

const STORAGE_KEY = "passes-design-variant"
const PASSES_STORAGE_KEY = "passes-layout-variant"

interface DesignVariantContextValue {
  variant: DesignVariant
  setVariant: (v: DesignVariant) => void
  cycleVariant: () => void
  passesVariant: PassesVariant
  setPassesVariant: (v: PassesVariant) => void
}

const DesignVariantContext = createContext<DesignVariantContextValue>({
  variant: "snap",
  setVariant: () => {},
  cycleVariant: () => {},
  passesVariant: "stacked",
  setPassesVariant: () => {},
})

export function useDesignVariant() {
  return useContext(DesignVariantContext)
}

const VARIANTS: DesignVariant[] = ["snap"]
const PASSES_VARIANTS: PassesVariant[] = [
  "stacked",
  "tabs",
  "compact",
  "accordion",
]

export function DesignVariantProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [variant, setVariantState] = useState<DesignVariant>("snap")
  const [passesVariant, setPassesVariantState] =
    useState<PassesVariant>("stacked")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && !VARIANTS.includes(stored as DesignVariant)) {
      localStorage.removeItem(STORAGE_KEY)
    }
    const storedPasses = localStorage.getItem(
      PASSES_STORAGE_KEY,
    ) as PassesVariant | null
    if (storedPasses && PASSES_VARIANTS.includes(storedPasses)) {
      setPassesVariantState(storedPasses)
    }
  }, [])

  const setVariant = (v: DesignVariant) => {
    setVariantState(v)
    localStorage.setItem(STORAGE_KEY, v)
  }

  const cycleVariant = () => {
    const currentIndex = VARIANTS.indexOf(variant)
    const nextIndex = (currentIndex + 1) % VARIANTS.length
    setVariant(VARIANTS[nextIndex])
  }

  const setPassesVariant = (v: PassesVariant) => {
    setPassesVariantState(v)
    localStorage.setItem(PASSES_STORAGE_KEY, v)
  }

  return (
    <DesignVariantContext.Provider
      value={{
        variant,
        setVariant,
        cycleVariant,
        passesVariant,
        setPassesVariant,
      }}
    >
      {children}
    </DesignVariantContext.Provider>
  )
}
