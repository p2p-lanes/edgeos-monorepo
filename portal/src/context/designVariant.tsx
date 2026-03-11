"use client"

import { createContext, useContext, useEffect, useState } from "react"

export type DesignVariant = "scrolly" | "snap"

const STORAGE_KEY = "passes-design-variant"

interface DesignVariantContextValue {
  variant: DesignVariant
  setVariant: (v: DesignVariant) => void
  cycleVariant: () => void
}

const DesignVariantContext = createContext<DesignVariantContextValue>({
  variant: "scrolly",
  setVariant: () => {},
  cycleVariant: () => {},
})

export function useDesignVariant() {
  return useContext(DesignVariantContext)
}

const VARIANTS: DesignVariant[] = ["scrolly", "snap"]

export function DesignVariantProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [variant, setVariantState] = useState<DesignVariant>("scrolly")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as DesignVariant | null
    if (stored && VARIANTS.includes(stored)) {
      setVariantState(stored)
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

  return (
    <DesignVariantContext.Provider
      value={{ variant, setVariant, cycleVariant }}
    >
      {children}
    </DesignVariantContext.Provider>
  )
}
