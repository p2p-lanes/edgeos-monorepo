"use client"

import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function SearchField({ value, onChange, className }: SearchFieldProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]",
        className,
      )}
    >
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("events.toolbar.search_placeholder")}
        className="pl-9"
      />
    </div>
  )
}
