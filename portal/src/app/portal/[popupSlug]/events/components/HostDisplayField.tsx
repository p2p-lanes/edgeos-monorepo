"use client"

import { useQuery } from "@tanstack/react-query"
import { UserSearch } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { type HumanPortalPublic, HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface HostDisplayFieldProps {
  value: string
  onChange: (next: string) => void
  currentUserName?: string | null
  popupName?: string | null
  /** Required for the participant picker; when missing, the button is disabled. */
  popupId?: string | null
}

function humanName(h: HumanPortalPublic): string {
  const name = [h.first_name, h.last_name].filter(Boolean).join(" ").trim()
  return name || h.id.slice(0, 8)
}

export function HostDisplayField({
  value,
  onChange,
  currentUserName,
  popupName,
  popupId,
}: HostDisplayFieldProps) {
  const { t } = useTranslation()
  const trimmedPopup = popupName?.trim() || ""
  const trimmedUser = currentUserName?.trim() || ""

  const [pickerOpen, setPickerOpen] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput), 250)
    return () => clearTimeout(handle)
  }, [searchInput])
  const trimmedSearch = debouncedSearch.trim()

  const { data: results, isFetching } = useQuery({
    queryKey: ["host-picker-humans", trimmedSearch],
    queryFn: () =>
      HumansService.searchHumansPortal({
        search: trimmedSearch || null,
        limit: 10,
      }),
    enabled: pickerOpen,
  })

  return (
    <div className="space-y-2">
      <Label htmlFor="host">{t("events.form.host_label")}</Label>
      <Input
        id="host"
        value={value}
        maxLength={255}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          trimmedPopup
            ? t("events.form.host_placeholder_default", { name: trimmedPopup })
            : t("events.form.host_placeholder_optional")
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {trimmedPopup && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(trimmedPopup)}
          >
            {t("events.form.host_use_popup", { name: trimmedPopup })}
          </Button>
        )}
        {trimmedUser && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(trimmedUser)}
          >
            {t("events.form.host_use_me")}
          </Button>
        )}
        <Popover
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open)
            if (!open) setSearchInput("")
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!popupId}
            >
              <UserSearch className="mr-1 h-3.5 w-3.5" />
              {t("events.form.host_pick_participant")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="border-b p-2">
              <Input
                autoFocus
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("events.form.host_search_placeholder")}
                className="h-8"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {results?.results?.length ? (
                results.results.map((h) => {
                  const name = humanName(h)
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        onChange(name)
                        setPickerOpen(false)
                        setSearchInput("")
                      }}
                    >
                      {h.picture_url ? (
                        // biome-ignore lint/performance/noImgElement: user-uploaded S3 avatar
                        <img
                          src={h.picture_url}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                          {name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="truncate font-medium">{name}</span>
                    </button>
                  )
                })
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {isFetching
                    ? t("events.form.host_searching")
                    : trimmedSearch
                      ? t("events.form.host_no_matches")
                      : t("events.form.host_type_to_search")}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-muted-foreground">
        {trimmedPopup
          ? t("events.form.host_helper_with_popup", { name: trimmedPopup })
          : t("events.form.host_helper")}
      </p>
    </div>
  )
}
