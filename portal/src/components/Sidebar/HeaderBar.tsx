import { ChevronRight } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { Fragment, useEffect, useState } from "react"
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "../ui/breadcrumb"
import BreadcrumbSegment from "./BreadcrumbSegment"
import CartBadge from "./CartBadge"
import useGroupMapping from "./hooks/useGroupMapping"
import { SidebarTrigger } from "./SidebarComponents"

const SHOW_THRESHOLD = 64
const DELTA = 4
const HEADER_HEIGHT = 56 // matches h-14

function useHideOnScroll() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const lastScrollMap = new WeakMap<EventTarget, number>()

    const onScroll = (event: Event) => {
      const target = event.target
      if (!target) return
      const el =
        target instanceof Document
          ? (document.scrollingElement ?? document.documentElement)
          : (target as HTMLElement)
      const currentY = el.scrollTop
      const lastY = lastScrollMap.get(target) ?? 0
      const diff = currentY - lastY
      lastScrollMap.set(target, currentY)

      if (currentY <= SHOW_THRESHOLD) {
        setHidden(false)
        return
      }
      if (diff > DELTA) {
        // Only hide when there is at least one header's worth of room left
        // below. Hiding collapses the header to h-0, which grows the scroll
        // container; if scrollTop would no longer fit, the browser clamps it
        // down and emits a scroll-up event, re-showing the header and looping
        // every frame on short pages.
        const roomBelow = el.scrollHeight - el.clientHeight - currentY
        if (roomBelow >= HEADER_HEIGHT) setHidden(true)
      } else if (diff < -DELTA) setHidden(false)
    }

    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true })
    }
  }, [])

  return hidden
}

const HeaderBar = () => {
  const { getCity } = useCityProvider()
  const pathname = usePathname()
  const city = getCity()
  const router = useRouter()
  const { groupMapping, isLoading } = useGroupMapping()
  const hidden = useHideOnScroll()

  const handleClickCity = () => {
    router.push(`/portal/${city?.slug}`)
  }

  const pathSegments = pathname.split("/").filter(Boolean).slice(2)
  const fallbackSegments =
    city?.sale_type === "direct" ? ["checkout"] : ["application"]
  const pathsToDisplay =
    pathSegments.length > 0 ? pathSegments : fallbackSegments

  // Build cumulative href per segment so each breadcrumb links back to its
  // own level. Anchored at `/portal/{slug}` when a slug is present;
  // otherwise we hand the raw path through and let the segment render as
  // a non-clickable label via `href=undefined`.
  const base = city?.slug ? `/portal/${city.slug}` : null

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-4 border-b bg-sidebar px-6 text-nav-text transition-[height,transform] duration-300 ease-out",
        hidden && "h-0 -translate-y-full overflow-hidden border-b-0",
      )}
    >
      <SidebarTrigger />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <button type="button" onClick={handleClickCity}>
                {city?.name}
              </button>
            </BreadcrumbLink>
          </BreadcrumbItem>

          {pathsToDisplay.map((path, idx) => {
            const isCurrent = idx === pathsToDisplay.length - 1
            const href =
              base != null
                ? `${base}/${pathsToDisplay.slice(0, idx + 1).join("/")}`
                : undefined
            return (
              <Fragment key={path}>
                <BreadcrumbSeparator>
                  <ChevronRight className="h-4 w-4" />
                </BreadcrumbSeparator>
                <BreadcrumbSegment
                  path={path}
                  href={href}
                  isCurrent={isCurrent}
                  isLoading={isLoading}
                  groupMapping={groupMapping}
                />
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        <CartBadge />
        <LanguageSwitcher />
      </div>
    </header>
  )
}

export default HeaderBar
