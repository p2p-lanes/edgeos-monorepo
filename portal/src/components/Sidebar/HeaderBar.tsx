import { ChevronRight } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { Fragment, useEffect, useState } from "react"
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher"
import { MobilePopupSwitcher } from "@/components/MobilePopupSwitcher"
import { useIsMobile } from "@/hooks/useIsMobile"
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
import useBreadcrumbNameMapping from "./hooks/useBreadcrumbNameMapping"
import { SidebarTrigger } from "./SidebarComponents"

const SHOW_THRESHOLD = 64
// Cumulative scroll distance (px) in one direction before the header toggles.
// Replaces the old bare per-event DELTA; hysteresis kills the wobble re-trigger
// that tiny direction flips (common with touch/momentum scroll) used to cause.
const TOGGLE_DISTANCE = 10
const HEADER_HEIGHT = 56 // matches h-14

function useHideOnScroll(enabled: boolean) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // Force the header open whenever the hook is disabled (e.g. a
    // desktop→mobile resize while hidden), then bail without attaching a
    // listener so mobile keeps a static header.
    if (!enabled) {
      setHidden(false)
      return
    }

    const lastScrollMap = new WeakMap<EventTarget, number>()
    // Signed cumulative movement per target since the last direction flip.
    // Positive = net downscroll, negative = net upscroll.
    const accumMap = new WeakMap<EventTarget, number>()

    let frame = 0
    let pendingTarget: EventTarget | null = null
    let pendingEl: HTMLElement | Element | null = null

    const evaluate = () => {
      frame = 0
      const target = pendingTarget
      const el = pendingEl
      pendingTarget = null
      pendingEl = null
      if (!target || !el) return

      const currentY = el.scrollTop
      const lastY = lastScrollMap.get(target) ?? 0
      const diff = currentY - lastY
      lastScrollMap.set(target, currentY)

      if (currentY <= SHOW_THRESHOLD) {
        accumMap.set(target, 0)
        setHidden(false)
        return
      }

      // Accumulate signed movement; reset when direction flips so a reversal
      // starts counting from zero rather than from a stale opposite total.
      const prevAccum = accumMap.get(target) ?? 0
      const accum =
        Math.sign(diff) === Math.sign(prevAccum) ? prevAccum + diff : diff
      accumMap.set(target, accum)

      if (accum >= TOGGLE_DISTANCE) {
        // Only hide when there is at least one header's worth of room left
        // below. Hiding collapses the header to h-0, which grows the scroll
        // container; if scrollTop would no longer fit, the browser clamps it
        // down and emits a scroll-up event, re-showing the header and looping
        // every frame on short pages.
        const roomBelow = el.scrollHeight - el.clientHeight - currentY
        if (roomBelow >= HEADER_HEIGHT) {
          setHidden(true)
          accumMap.set(target, 0)
        }
      } else if (accum <= -TOGGLE_DISTANCE) {
        setHidden(false)
        accumMap.set(target, 0)
      }
    }

    const onScroll = (event: Event) => {
      const target = event.target
      if (!target) return
      // Ignore scrolls inside floating UI (popovers, dropdowns, dialogs,
      // toasts). They are local overflow containers, not page-level scroll.
      if (
        target instanceof HTMLElement &&
        target.closest(
          "[data-radix-popper-content-wrapper],[role='dialog'],[data-sonner-toaster]",
        )
      ) {
        return
      }
      const el =
        target instanceof Document
          ? (document.scrollingElement ?? document.documentElement)
          : (target as HTMLElement)
      // Stash the latest target and run the decision logic at most once per
      // painted frame, so momentum scroll can't fire the toggle many times
      // per frame.
      pendingTarget = target
      pendingEl = el
      if (frame === 0) frame = requestAnimationFrame(evaluate)
    }

    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true })
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [enabled])

  return hidden
}

const HeaderBar = () => {
  const { getCity } = useCityProvider()
  const pathname = usePathname()
  const city = getCity()
  const router = useRouter()
  const isMobile = useIsMobile()
  const hidden = useHideOnScroll(!isMobile)

  const handleClickCity = () => {
    router.push(`/portal/${city?.slug}`)
  }

  const pathSegments = pathname.split("/").filter(Boolean).slice(2)
  const fallbackSegments =
    city?.sale_type === "direct" ? ["checkout"] : ["application"]
  const pathsToDisplay =
    pathSegments.length > 0 ? pathSegments : fallbackSegments

  const { nameMapping, isLoading } = useBreadcrumbNameMapping(
    pathSegments,
    city?.id,
  )

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
                  nameMapping={nameMapping}
                />
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        <MobilePopupSwitcher />
        <CartBadge />
        <LanguageSwitcher />
      </div>
    </header>
  )
}

export default HeaderBar
