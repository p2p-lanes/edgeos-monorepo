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
import { cn } from "@/lib/utils"
import { useLanguage } from "@/providers/languageProvider"

interface LanguageSwitcherProps {
  /** Hide the language label, leaving only the globe + tight chevron. */
  compact?: boolean
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { currentLanguage, supportedLanguages, setLanguage } = useLanguage()

  if (supportedLanguages.length <= 1) return null

  return (
    <Select value={currentLanguage} onValueChange={setLanguage}>
      <SelectTrigger
        aria-label="Change language"
        // Compact trigger drops the current-language label entirely (globe
        // icon + tight chevron only) and shrinks the chevron. Used in the
        // checkout header where the switcher is a secondary affordance and
        // shouldn't compete with the step nav. The chevron is rendered by
        // <SelectTrigger> itself; sizing it down is via `[&>svg]:` so we
        // don't have to fork the trigger component.
        className={cn(
          "w-auto gap-2 border-none bg-transparent shadow-none focus:ring-0 focus:ring-offset-0",
          compact && "px-2 gap-1 [&>svg]:size-3",
        )}
      >
        <Globe className="h-4 w-4" />
        {/* SelectValue renders the current selection's label; we drop it
            entirely in compact mode so the trigger is icon + chevron only. */}
        {compact ? null : <SelectValue />}
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
