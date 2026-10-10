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
}> = ({ resource, level = 0, onNavigate, pathname }) => {
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
          {resource.children.map((child) => (
            <ResourceItem
              key={child.name}
              resource={child}
              level={level + 1}
              onNavigate={onNavigate}
              pathname={pathname}
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
        sections?: {
          id: string
          kind: "commerce" | "checkouts" | "community" | "external"
          title?: string
          links?: { id: string; label: string; url: string }[]
        }[]
      }
    | null
    | undefined
  const router = useRouter()
  const pathname = usePathname()

  const handleNavigate = useCallback(
    (path: string) => {
      trackPortalTelemetry("portal_navigation")
      router.push(path)
    },
    [router],
  )

  const configuredSections = sidebarConfig?.sections
    ? [
        ...sidebarConfig.sections,
        ...resourceGroups
          .filter(
            (group) =>
              !sidebarConfig.sections?.some(
                (section) => section.kind === group,
              ),
          )
          .map((group) => ({ id: group, kind: group })),
      ]
    : null

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
              />
            ))}
            {group === "community" && (
              <>
                <Separator className="my-4" />
                <GroupsResources onNavigate={handleNavigate} />
              </>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const renderExternalSection = (section: {
    id: string
    title?: string
    links?: { id: string; label: string; url: string }[]
  }) => {
    const links = (section.links ?? []).filter(
      (link) =>
        link.url.trim() !== "" &&
        !/^(javascript|data|vbscript):/i.test(link.url.trim()),
    )
    if (links.length === 0) return null
    const labelId = `portal-navigation-${section.id}`
    return (
      <SidebarGroup key={section.id} aria-labelledby={labelId}>
        <SidebarGroupLabel asChild>
          <h2
            id={labelId}
            className="px-2 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/60 uppercase"
          >
            {section.title}
          </h2>
        </SidebarGroupLabel>
        <SidebarGroupContent className="pt-1">
          <SidebarMenu>
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

  return (
    <SidebarContent>
      <nav aria-label={t("sidebar.navigation")}>
        {configuredSections
          ? configuredSections.map((section) =>
              section.kind === "external"
                ? renderExternalSection(section)
                : renderResourceSection(section.kind),
            )
          : resourceGroups.map(renderResourceSection)}
      </nav>
    </SidebarContent>
  )
}
export default ResourcesMenu
