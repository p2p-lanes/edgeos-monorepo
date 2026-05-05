"use client"

import { Globe } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SUPPORTED_LANGUAGES } from "@/i18n/config"
import { useLanguage } from "@/providers/languageProvider"

export function LanguageSwitcher() {
  const { currentLanguage, supportedLanguages, setLanguage } = useLanguage()

  if (supportedLanguages.length <= 1) return null

  return (
    <Select value={currentLanguage} onValueChange={setLanguage}>
      <SelectTrigger className="w-auto gap-2 border-none bg-transparent shadow-none focus:ring-0 focus:ring-offset-0">
        <Globe className="h-4 w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedLanguages.map((code) => {
          const label =
            SUPPORTED_LANGUAGES[code as keyof typeof SUPPORTED_LANGUAGES]
          if (!label) return null

          return (
            <SelectItem key={code} value={code}>
              {label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
