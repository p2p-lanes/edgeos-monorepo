"use client"

import { ChevronsUpDown } from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { PopupPublic } from "@/client"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Mobile-only pop-up city switcher for the header. Desktop users switch from
 * the sidebar's PopupsMenu; on mobile that menu lives behind the off-canvas
 * trigger, so this surfaces the same action inline. Hidden when there's only
 * one popup to choose from.
 */
export function MobilePopupSwitcher() {
  const { getCity, getPopups } = useCityProvider()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const city = getCity()
  const popups = getPopups()

  if (!city || popups.length < 2) return null

  const switchTo = (popup: PopupPublic) => {
    setOpen(false)
    router.replace(`/portal/${popup.slug}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch pop-up city"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm text-nav-text md:hidden"
        >
          {city.icon_url ? (
            <Image
              src={city.icon_url}
              alt=""
              width={20}
              height={20}
              className="rounded"
            />
          ) : null}
          <span className="max-w-[6rem] truncate">{city.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {popups.map((popup) => (
          <button
            key={popup.slug}
            type="button"
            onClick={() => switchTo(popup)}
            className={cn(
              "w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
              popup.slug === city.slug && "font-semibold",
            )}
          >
            {popup.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
