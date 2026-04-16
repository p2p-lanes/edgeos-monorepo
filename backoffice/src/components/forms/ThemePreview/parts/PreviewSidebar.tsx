import { type CalendarDays, FileText, Ticket, User, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatShortDate } from "./dateFormat"
import { useDisplayEvent, usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

// Replica of portal/src/components/Sidebar/BackofficeSidebar (PopupsMenu +
// ResourcesMenu + FooterMenu) matching the screenshot layout.
export function PreviewSidebar() {
  const { highlightedKeys } = usePreview()
  const event = useDisplayEvent()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col self-stretch",
        ringIf(isHl("sidebar", "sidebar_foreground", "sidebar_border")),
      )}
      style={{
        width: 220,
        backgroundColor: "var(--sidebar)",
        color: "var(--sidebar-foreground)",
        borderRight: "1px solid var(--sidebar-border)",
      }}
    >
      {/* Event header (PopupsMenu) */}
      <div
        className="flex items-start gap-2 p-3"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold",
            ringIf(isHl("sidebar_primary", "sidebar_primary_foreground")),
          )}
          style={{
            backgroundColor: "var(--sidebar-primary)",
            color: "var(--sidebar-primary-foreground)",
            borderRadius: "var(--radius)",
          }}
        >
          {event.initial}
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="truncate text-sm font-semibold"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            {event.name}
          </span>
          <span
            className="mt-0.5 truncate text-[11px]"
            style={{
              color:
                "color-mix(in oklab, var(--sidebar-foreground) 65%, transparent)",
            }}
          >
            {event.location}
          </span>
          <span
            className="mt-0.5 truncate text-[11px]"
            style={{
              color:
                "color-mix(in oklab, var(--sidebar-foreground) 65%, transparent)",
            }}
          >
            {formatShortDate(event.start_date)}
          </span>
        </div>
      </div>

      {/* Resources — "Tu Participación" */}
      <div className="flex-1 overflow-hidden p-2">
        <div
          className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            color:
              "color-mix(in oklab, var(--sidebar-foreground) 55%, transparent)",
          }}
        >
          Tu Participación
        </div>

        {/* Active item: Aplicación with "accepted" badge */}
        <div
          className={cn(
            "mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
            ringIf(isHl("sidebar_accent", "sidebar_accent_foreground")),
          )}
          style={{
            backgroundColor: "var(--sidebar-accent)",
            color: "var(--sidebar-accent-foreground)",
            borderRadius: "var(--radius)",
          }}
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>Aplicación</span>
          </div>
          <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-800">
            accepted
          </span>
        </div>

        <SidebarItem icon={Ticket} label="Pases" />
        <SidebarItem icon={Users} label="Directorio de Asistentes" />
      </div>

      {/* Footer: EdgeOS + profile */}
      <div
        className="p-2"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        <div className="mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
          <span style={{ color: "var(--sidebar-foreground)" }}>EdgeOS</span>
          <span
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            <span className="text-amber-400">★</span>
            49
          </span>
        </div>
        <SidebarItem icon={User} label="Mi Perfil" />
      </div>

      {/* Focus ring sample (only visible when sidebar_ring hovered) */}
      {isHl("sidebar_ring") && (
        <div
          className="m-2 rounded-md px-2 py-1.5 text-[11px]"
          style={{
            boxShadow: "0 0 0 2px var(--sidebar-ring)",
            color: "var(--sidebar-foreground)",
          }}
        >
          Item con foco
        </div>
      )}
    </aside>
  )
}

function SidebarItem({
  icon: Icon,
  label,
}: {
  icon: typeof CalendarDays
  label: string
}) {
  return (
    <div
      className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
      style={{ color: "var(--sidebar-foreground)" }}
    >
      <Icon className="h-4 w-4 opacity-80" />
      <span className="truncate">{label}</span>
    </div>
  )
}
