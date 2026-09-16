import { describe, expect, it } from "vitest"
import en from "./locales/en.json"
import es from "./locales/es.json"
import is from "./locales/is.json"
import zh from "./locales/zh.json"

describe("Directory localization", () => {
  it("keeps the attendee navigation, title, and breadcrumb on their existing keys", () => {
    const locales = { en, es, is, zh }
    for (const [locale, labels] of Object.entries({
      en: ["Directory", "Directory", "Directory"],
      es: ["Directorio", "Directorio", "Directorio"],
      is: ["Skrá", "Skrá", "Skrá"],
      zh: ["名录", "名录", "名录"],
    })) {
      const messages = locales[locale as keyof typeof locales]

      expect([
        messages.sidebar.attendee_directory,
        messages.attendees.title,
        messages.breadcrumbs.attendees,
      ]).toEqual(labels)
    }
  })
})
