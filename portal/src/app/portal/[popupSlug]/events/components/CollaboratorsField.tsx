"use client"

import { useQuery } from "@tanstack/react-query"
import { UserPlus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type EventCollaboratorPublic,
  type HumanPortalPublic,
  HumansService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface CollaboratorsFieldProps {
  /** Selected collaborator human ids — the form's source of truth. */
  value: string[]
  onChange: (next: string[]) => void
  /** Required for the participant search; the add button is disabled without it. */
  popupId?: string | null
  /**
   * Already-saved collaborators (from ``event.collaborators``), used to label
   * the chips with names/avatars without re-searching. Only relevant on edit.
   */
  initialCollaborators?: EventCollaboratorPublic[]
}

type KnownHuman = EventCollaboratorPublic | HumanPortalPublic

function humanName(h: {
  id: string
  first_name?: string | null
  last_name?: string | null
}): string {
  const name = [h.first_name, h.last_name].filter(Boolean).join(" ").trim()
  return name || h.id.slice(0, 8)
}

export function CollaboratorsField({
  value,
  onChange,
  popupId,
  initialCollaborators,
}: CollaboratorsFieldProps) {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput), 250)
    return () => clearTimeout(handle)
  }, [searchInput])
  const trimmedSearch = debouncedSearch.trim()

  // id -> display info. Seeded from already-saved collaborators and grown as
  // the user searches/picks, so a selected chip always has a name to show.
  const [known, setKnown] = useState<Record<string, KnownHuman>>(() => {
    const seed: Record<string, KnownHuman> = {}
    for (const c of initialCollaborators ?? []) seed[c.id] = c
    return seed
  })
  // The event loads async on the edit page, so initialCollaborators can arrive
  // after first paint — absorb any new ones without clobbering picked entries.
  useEffect(() => {
    if (!initialCollaborators?.length) return
    setKnown((prev) => {
      let changed = false
      const next = { ...prev }
      for (const c of initialCollaborators) {
        if (!next[c.id]) {
          next[c.id] = c
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [initialCollaborators])

  const { data: results, isFetching } = useQuery({
    queryKey: ["collaborator-picker-humans", popupId, trimmedSearch],
    queryFn: () =>
      HumansService.searchHumansPortal({
        popupId: popupId!,
        search: trimmedSearch || null,
        limit: 10,
      }),
    enabled: open && !!popupId,
  })

  const add = (h: HumanPortalPublic) => {
    setKnown((prev) => (prev[h.id] ? prev : { ...prev, [h.id]: h }))
    if (!value.includes(h.id)) onChange([...value, h.id])
  }
  const remove = (id: string) => onChange(value.filter((x) => x !== id))

  const selected = useMemo(
    () => value.map((id) => known[id] ?? { id }),
    [value, known],
  )

  return (
    <div className="space-y-2">
      <Label>{t("events.form.collaborators_label")}</Label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((h) => {
            const name = humanName(h)
            return (
              <span
                key={h.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-1 pr-2 text-xs"
              >
                {h.picture_url ? (
                  // biome-ignore lint/performance/noImgElement: user-uploaded S3 avatar
                  <img
                    src={h.picture_url}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground">
                    {name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[10rem] truncate font-medium">
                  {name}
                </span>
                <button
                  type="button"
                  aria-label={t("events.form.collaborators_remove", { name })}
                  onClick={() => remove(h.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearchInput("")
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
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            {t("events.form.collaborators_add")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
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
                const already = value.includes(h.id)
                return (
                  <button
                    key={h.id}
                    type="button"
                    disabled={already}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    onClick={() => add(h)}
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
                    {already && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {t("events.form.collaborators_added")}
                      </span>
                    )}
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

      <p className="text-xs text-muted-foreground">
        {t("events.form.collaborators_helper")}
      </p>
    </div>
  )
}
