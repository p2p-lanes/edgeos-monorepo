import {
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguageTag,
  persistLanguage,
  resolveRequestLanguage,
  setActiveRequestLanguage,
  subscribeRequestLanguage,
} from "./language-storage"

function setSearch(search: string) {
  window.history.replaceState({}, "", `/checkout/festival${search}`)
}

function clearCookies() {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim()
    // biome-ignore lint/suspicious/noDocumentCookie: mirrors persistLanguage, which writes cookies the same way
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
}

beforeEach(() => {
  localStorage.clear()
  clearCookies()
  setSearch("")
  setActiveRequestLanguage(null)
})

describe("normalizeLanguageTag", () => {
  it("reduces a region-qualified tag to its base subtag", () => {
    expect(normalizeLanguageTag("es-AR")).toBe("es")
  })

  it("takes the first entry of a full Accept-Language list", () => {
    expect(normalizeLanguageTag("en-US,en;q=0.9,es;q=0.8")).toBe("en")
  })

  it("lowercases and trims", () => {
    expect(normalizeLanguageTag("  EN  ")).toBe("en")
  })

  it("returns null for empty or missing input", () => {
    expect(normalizeLanguageTag(null)).toBeNull()
    expect(normalizeLanguageTag(undefined)).toBeNull()
    expect(normalizeLanguageTag("")).toBeNull()
    expect(normalizeLanguageTag("   ")).toBeNull()
  })
})

describe("resolveRequestLanguage", () => {
  it("returns null when nothing is set", () => {
    expect(resolveRequestLanguage()).toBeNull()
  })

  it("falls back to the stored language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es")
    expect(resolveRequestLanguage()).toBe("es")
  })

  it("prefers the ?lang param over the stored language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es")
    setSearch("?lang=en")
    expect(resolveRequestLanguage()).toBe("en")
  })

  it("accepts ?locale as an alias for ?lang", () => {
    setSearch("?locale=zh")
    expect(resolveRequestLanguage()).toBe("zh")
  })

  it("prefers the on-screen language over both, so a mid-session switch wins before its ?lang navigation lands", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es")
    setSearch("?lang=es")
    setActiveRequestLanguage("en")
    expect(resolveRequestLanguage()).toBe("en")
  })

  it("normalizes whatever it resolves, so one language cannot split the query cache", () => {
    setSearch("?lang=en-US")
    expect(resolveRequestLanguage()).toBe("en")
  })
})

describe("persistLanguage", () => {
  it("writes localStorage and the server-readable cookie together", () => {
    persistLanguage("es")

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es")
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE_KEY}=es`)
  })

  it("overwrites a previous choice in both stores", () => {
    persistLanguage("es")
    persistLanguage("en")

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en")
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE_KEY}=en`)
    expect(document.cookie).not.toContain(`${LANGUAGE_COOKIE_KEY}=es`)
  })
})

describe("subscribeRequestLanguage", () => {
  it("notifies listeners when the on-screen language changes", () => {
    const listener = vi.fn()
    subscribeRequestLanguage(listener)

    setActiveRequestLanguage("en")

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("does not notify when the language is set to the same value", () => {
    setActiveRequestLanguage("en")
    const listener = vi.fn()
    subscribeRequestLanguage(listener)

    setActiveRequestLanguage("en")

    expect(listener).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRequestLanguage(listener)

    unsubscribe()
    setActiveRequestLanguage("es")

    expect(listener).not.toHaveBeenCalled()
  })
})
