"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import useResources from "@/hooks/useResources"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Mobile-only bottom navigation. Surfaces the popup's top-level sections
 * (Events / Application / Passes / Attendee Directory…) as a thumb-reachable
 * bar. Events is pinned leftmost — it's the default landing for ticket
 * holders (see the portal landing redirect). Visibility mirrors the sidebar:
 * we render the same active resources `useResources` exposes, so a section the
 * user can't access never shows up here either.
 */
export function BottomNav() {
  const { resources } = useResources()
  const { getCity } = useCityProvider()
  const pathname = usePathname()
  const city = getCity()
  const landingPath = city?.slug ? `/portal/${city.slug}` : null
  const eventsPath = landingPath ? `${landingPath}/events` : null

  const items = resources
    .filter((r) => r.status === "active" && r.path)
    .map((r) => ({ name: r.name, icon: r.icon, path: r.path as string }))
    // Events first; keep the rest in their declared order.
    .sort((a, b) => {
      const aRank = a.path === eventsPath ? 0 : 1
      const bRank = b.path === eventsPath ? 0 : 1
      return aRank - bRank
    })

  if (items.length === 0) return null

  const isActive = (path: string) => {
    // The landing path is a prefix of every other section, so it only counts
    // as active on an exact match.
    if (path === landingPath) return pathname === landingPath
    return pathname === path || pathname.startsWith(`${path}/`)
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(item.path)
          const Icon = item.icon
          return (
            <li key={item.path} className="min-w-0 flex-1">
              <Link
                href={item.path}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="h-5 w-5 shrink-0" />}
                <span className="max-w-full truncate">{item.name}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
