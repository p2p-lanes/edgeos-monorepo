"use client"

import { Filter } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface TagsPopoverProps {
  allowedTags: string[]
  selectedTags: string[]
  onChange: (tags: string[]) => void
  triggerClassName?: string
}

export function TagsPopover({
  allowedTags,
  selectedTags,
  onChange,
  triggerClassName,
}: TagsPopoverProps) {
  const { t } = useTranslation()
  const count = selectedTags.length
  const active = count > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "default" : "outline"}
          size="sm"
          title={t("events.toolbar.filter_by_tags")}
          aria-label={t("events.toolbar.tags_label")}
          className={cn("px-2 sm:px-3", triggerClassName)}
        >
          <Filter className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">
            {t("events.toolbar.tags_label")}
          </span>
          {active && <span className="ml-1 text-xs opacity-80">({count})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("events.toolbar.filter_by_tag_label")}
          </span>
          {active && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange([])}
            >
              {t("events.toolbar.clear_filters")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {allowedTags.map((tag) => {
            const isActive = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  onChange(
                    isActive
                      ? selectedTags.filter((x) => x !== tag)
                      : [...selectedTags, tag],
                  )
                }}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-input bg-background text-foreground hover:bg-muted",
                )}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
