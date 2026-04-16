import { createContext, type ReactNode, useContext, useMemo } from "react"
import type { PreviewEvent } from "../types"

interface PreviewContextValue {
  event: PreviewEvent
  highlightedKeys: Set<string>
  headingScale: number
}

const PreviewContext = createContext<PreviewContextValue | null>(null)

export function PreviewProvider({
  children,
  event,
  highlightedKeys,
  headingScale,
}: PreviewContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ event, highlightedKeys, headingScale }),
    [event, highlightedKeys, headingScale],
  )
  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  )
}

export function usePreview() {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error("usePreview must be used inside PreviewProvider")
  return ctx
}

// Resolves a PreviewEvent field to its display value, falling back to a mock
// when the popup form hasn't been filled in yet.
const DISPLAY_FALLBACKS = {
  name: "Mi Evento",
  tagline: "Una descripción breve del evento",
  location: "Ubicación",
}

export function useDisplayEvent() {
  const { event } = usePreview()
  return useMemo(() => {
    const name = event.name?.trim() || DISPLAY_FALLBACKS.name
    return {
      name,
      tagline: event.tagline?.trim() || DISPLAY_FALLBACKS.tagline,
      location: event.location?.trim() || DISPLAY_FALLBACKS.location,
      start_date: event.start_date,
      end_date: event.end_date,
      initial: name[0]?.toUpperCase() ?? "A",
    }
  }, [event])
}
