import { ChevronRight } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { Fragment } from "react"
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher"
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

const HeaderBar = () => {
  const { getCity } = useCityProvider()
  const pathname = usePathname()
  const city = getCity()
  const router = useRouter()
  const { groupMapping, isLoading } = useGroupMapping()

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
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-sidebar px-6 text-nav-text">
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
