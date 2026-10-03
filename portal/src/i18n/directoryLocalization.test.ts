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

  it.each([
    {
      locale: "en",
      messages: en,
      placeholder: "Search by name, email, or Telegram...",
    },
    {
      locale: "es",
      messages: es,
      placeholder: "Buscar por nombre, email o Telegram...",
    },
    {
      locale: "is",
      messages: is,
      placeholder: "Leita eftir nafni, netfangi eða Telegram...",
    },
    {
      locale: "zh",
      messages: zh,
      placeholder: "按姓名、邮箱或 Telegram 搜索...",
    },
  ])("describes only supported directory search fields ($locale)", ({
    messages,
    placeholder,
  }) => {
    expect(messages.attendees.search_placeholder).toBe(placeholder)
  })
})
