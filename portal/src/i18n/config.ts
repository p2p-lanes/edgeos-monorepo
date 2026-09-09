import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./locales/en.json"
import es from "./locales/es.json"
import is from "./locales/is.json"
import zh from "./locales/zh.json"

export const SUPPORTED_LANGUAGES = {
  en: "English",
  es: "Español",
  zh: "中文",
  is: "Íslenska",
} as const

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    zh: { translation: zh },
    is: { translation: is },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
