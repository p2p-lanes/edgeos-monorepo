import { usePathname, useRouter } from "next/navigation"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import useResources from "@/hooks/useResources"
import { trackPortalTelemetry } from "@/lib/portal-telemetry"
import { useCityProvider } from "@/providers/cityProvider"
import type { Resource, ResourceGroup } from "@/types/resources"
import { Separator } from "../ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import GroupsResources from "./Groups/GroupsResources"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "./SidebarComponents"
import ResourceMenuItem from "./StatusResource/ResourceMenuItem"

const statusColor = (status: string) => {
  if (status === "pending") return "bg-yellow-100 text-yellow-800"
  if (status === "in review") return "bg-blue-100 text-blue-800"
  if (status === "accepted") return "bg-green-100 text-green-800"
  if (status === "rejected") return "bg-red-100 text-red-800"
  if (status === "withdrawn") return "bg-slate-300 text-slate-700"
  return "bg-gray-100 text-gray-800"
}

const resourceGroups: ResourceGroup[] = ["commerce", "checkouts", "community"]

const ResourceItem: React.FC<{
  resource: Resource
  level?: number
  onNavigate: (path: string) => void
  pathname: string
  hiddenItems?: string[]
}> = ({ resource, level = 0, onNavigate, pathname, hiddenItems = [] }) => {
  const { t } = useTranslation()

  const isActive = resource.path === pathname

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <ResourceMenuItem
            resource={resource}
            level={level}
            color={statusColor(resource.value as string)}
            onNavigate={onNavigate}
            isActive={isActive}
          />
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="portal-sidebar hidden group-data-[collapsible=icon]:block"
        >
          {resource.name}{" "}
          {resource.status === "soon" ? t("sidebar.coming_soon") : ""}
        </TooltipContent>
      </Tooltip>

      {resource.children && (
        <SidebarMenuSub>
          {resource.children
            .filter(
              (child) =>
                !hiddenItems.some((key) =>
                  key === "tracks"
                    ? child.path?.endsWith("/events/tracks")
                    : key === "venues"
                      ? child.path?.endsWith("/events/venues")
                      : key === "agentic_access"
                        ? child.path?.endsWith("/portal/agentic-access")
                        : false,
                ),
            )
            .map((child) => (
              <ResourceItem
                key={child.name}
                resource={child}
                level={level + 1}
                onNavigate={onNavigate}
                pathname={pathname}
                hiddenItems={hiddenItems}
              />
            ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}

const ResourcesMenu = () => {
  const { t } = useTranslation()
  const { resources, doorName } = useResources()
  const city = useCityProvider().getCity()
  const sidebarConfig = city?.sidebar_config as
    | {
        layout?: (
          | {
              id: string
              type: "section"
              title?: string
              group?: "commerce" | "checkouts" | "community"
              items: string[]
              links?: { id: string; label: string; url: string }[]
            }
          | { id: string; type: "item"; resource: string }
        )[]
        hidden_items?: string[]
      }
    | null
    | undefined
  const router = useRouter()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  // Every sidebar click closes the mobile sheet, including one on the page
  // already open; only an actual route change is pushed and tracked.
  const handleNavigate = useCallback(
    (path: string) => {
      setOpenMobile(false)
      if (path === pathname) return
      trackPortalTelemetry("portal_navigation")
      router.push(path)
    },
    [router, pathname, setOpenMobile],
  )

  const menuItemKey = (resource: Resource): string | undefined => {
    if (resource.group === "checkouts") return "checkouts"
    const names: Record<string, string> = {
      [t("sidebar.home")]: "home",
      [t("sidebar.application")]: "application",
      [t("sidebar.overview")]: "application",
      [t("sidebar.passes")]: "passes",
      [t("sidebar.orders")]: "orders",
      [t("sidebar.events")]: "events",
      [t("sidebar.attendee_directory")]: "directory",
      [t("sidebar.referrals")]: "referrals",
    }
    return names[resource.name]
  }

  const hiddenItems = sidebarConfig?.hidden_items ?? []
  const configuredLayout = sidebarConfig?.layout

  const renderResourceSection = (group: ResourceGroup) => {
    const groupResources = resources.filter(
      (resource) =>
        resource.status !== "hidden" && (resource.group ?? "general") === group,
    )
    if (groupResources.length === 0) return null

    const groupLabelId = `portal-navigation-${group}`
    return (
      <SidebarGroup key={group} aria-labelledby={groupLabelId}>
        <SidebarGroupLabel asChild>
          <h2
            id={groupLabelId}
            className="px-2 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/60 uppercase"
          >
            {group === "general" && doorName ? doorName : t(`sidebar.${group}`)}
          </h2>
        </SidebarGroupLabel>
        <SidebarGroupContent className="pt-1">
          <SidebarMenu>
            {groupResources.map((resource) => (
              <ResourceItem
                key={resource.path ?? resource.name}
                resource={resource}
                onNavigate={handleNavigate}
                pathname={pathname}
                hiddenItems={hiddenItems}
              />
            ))}
            {group === "community" && (
              <GroupsResources onNavigate={handleNavigate} />
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const renderResource = (resourceKey: string, keyPrefix: string) => {
    if (resourceKey === "groups") {
      return [
        <GroupsResources
          key={`${keyPrefix}-groups`}
          onNavigate={handleNavigate}
        />,
      ]
    }
    return resources
      .filter(
        (resource) =>
          resource.status !== "hidden" && menuItemKey(resource) === resourceKey,
      )
      .map((resource) => (
        <ResourceItem
          key={`${keyPrefix}-${resource.path ?? resource.name}`}
          resource={resource}
          onNavigate={handleNavigate}
          pathname={pathname}
          hiddenItems={hiddenItems}
        />
      ))
  }

  const renderConfiguredSection = (section: {
    id: string
    title?: string
    group?: ResourceGroup
    items: string[]
    links?: { id: string; label: string; url: string }[]
  }) => {
    const children = section.items.flatMap((key) =>
      renderResource(key, section.id),
    )
    const links = (section.links ?? []).filter(
      (link) =>
        link.url.trim() !== "" &&
        !/^(javascript|data|vbscript):/i.test(link.url.trim()),
    )
    if (children.length === 0 && links.length === 0) return null
    const labelId = `portal-navigation-${section.id}`
    return (
      <SidebarGroup key={section.id} aria-labelledby={labelId}>
        <SidebarGroupLabel asChild>
          <h2
            id={labelId}
            className="px-2 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/60 uppercase"
          >
            {section.title?.trim() ||
              (section.group ? t(`sidebar.${section.group}`) : "Section")}
          </h2>
        </SidebarGroupLabel>
        <SidebarGroupContent className="pt-1">
          <SidebarMenu>
            {children}
            {links.map((link) => (
              <SidebarMenuItem key={link.id}>
                <SidebarMenuButton asChild tooltip={link.label}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <span>{link.label}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const renderStandaloneResource = (block: {
    id: string
    resource: string
  }) => {
    const children = renderResource(block.resource, block.id)
    if (children.length === 0) return null
    return (
      <SidebarGroup key={block.id}>
        <SidebarGroupContent className="pt-1">
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const hasVisibleNavigation = configuredLayout
    ? configuredLayout.length > 0
    : resources.some((resource) => resource.status !== "hidden")

  return (
    <SidebarContent>
      <nav aria-label={t("sidebar.navigation")}>
        {configuredLayout
          ? configuredLayout.map((block) =>
              block.type === "section"
                ? renderConfiguredSection(block)
                : renderStandaloneResource(block),
            )
          : resourceGroups.map((group) => renderResourceSection(group))}
        {hasVisibleNavigation && <Separator className="my-4" />}
      </nav>
    </SidebarContent>
  )
}
export default ResourcesMenu
