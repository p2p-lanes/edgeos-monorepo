import { ChevronRight, User } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher"
import { MobilePopupSwitcher } from "@/components/MobilePopupSwitcher"
import { Button } from "@/components/ui/button"
import { useHasNoPortalPopups } from "@/hooks/useHasNoPortalPopups"
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

const HeaderBar = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const hasNoPopups = useHasNoPortalPopups()
  const pathname = usePathname()
  const city = getCity()
  const router = useRouter()

  const handleClickCity = () => {
    router.push(`/portal/${city?.slug}`)
  }

  const pathSegments = pathname.split("/").filter(Boolean).slice(2)
  const pathsToDisplay = pathSegments.length > 0 ? pathSegments : ["home"]

  const { nameMapping, isLoading } = useBreadcrumbNameMapping(
    pathSegments,
    city?.id,
  )

  // Build cumulative href per segment so each breadcrumb links back to its
  // own level. Shop has no aggregate route, so it remains a label. Without a
  // city slug, all segments render as non-clickable labels.
  const base = city?.slug ? `/portal/${city.slug}` : null

  // With no popup there is no sidebar to toggle and nothing to trail back
  // to, so the header keeps only the language and the profile link.
  if (hasNoPopups) {
    return (
      <header className="portal-chrome flex h-14 shrink-0 items-center justify-end gap-2 border-b bg-sidebar/95 px-3 text-nav-text backdrop-blur sm:px-6">
        <LanguageSwitcher portalContentClassName="portal-chrome" />
        <Button asChild variant="outline" size="sm">
          <Link href="/portal/profile">
            <User className="size-4" />
            {t("profile.my_profile")}
          </Link>
        </Button>
      </header>
    )
  }

  return (
    <header className="portal-chrome flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar/95 px-3 text-nav-text backdrop-blur sm:gap-4 sm:px-6">
      <SidebarTrigger />
      {/* Below md only the current page shows (truncated) so the trail never
          wraps out of the fixed-height header; the sidebar and the page's own
          back link cover navigation up the tree. */}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden shrink-0 md:inline-flex">
            <BreadcrumbLink asChild>
              <button type="button" onClick={handleClickCity}>
                {city?.name}
              </button>
            </BreadcrumbLink>
          </BreadcrumbItem>

          {pathsToDisplay.map((path, idx) => {
            const isCurrent = idx === pathsToDisplay.length - 1
            const href =
              base != null && path !== "shop"
                ? `${base}/${pathsToDisplay.slice(0, idx + 1).join("/")}`
                : undefined
            return (
              <Fragment key={path}>
                <BreadcrumbSeparator className="hidden shrink-0 md:block">
                  <ChevronRight className="h-4 w-4" />
                </BreadcrumbSeparator>
                <BreadcrumbSegment
                  path={path}
                  href={href}
                  isCurrent={isCurrent}
                  className={
                    isCurrent ? "min-w-0" : "hidden shrink-0 md:inline-flex"
                  }
                  isLoading={isLoading}
                  nameMapping={nameMapping}
                />
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <MobilePopupSwitcher />
        <CartBadge />
        <LanguageSwitcher portalContentClassName="portal-chrome" />
      </div>
    </header>
  )
}

export default HeaderBar
