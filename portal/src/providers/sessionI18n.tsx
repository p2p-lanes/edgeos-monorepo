"use client"

import { createInstance } from "i18next"
import { type ReactNode, useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { translationResources } from "@/i18n/config"

export function SessionI18n({
  children,
  language = "en",
}: {
  children: ReactNode
  language?: string
}) {
  const [instance] = useState(() => {
    const isolated = createInstance()
    void isolated.init({
      resources: translationResources,
      lng: language,
      fallbackLng: "en",
      initAsync: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
    return isolated
  })
  useEffect(() => {
    void instance.changeLanguage(language)
  }, [instance, language])
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}
