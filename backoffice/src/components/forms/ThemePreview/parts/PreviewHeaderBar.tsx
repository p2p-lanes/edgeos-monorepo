import { ChevronRight, Globe, PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDisplayEvent, usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

// Replica of portal/src/components/Sidebar/HeaderBar.tsx — sidebar trigger,
// breadcrumb and LanguageSwitcher.
export function PreviewHeaderBar() {
  const { highlightedKeys } = usePreview()
  const event = useDisplayEvent()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 px-4",
        ringIf(isHl("nav_text", "nav_text_secondary", "sidebar", "border")),
      )}
      style={{
        backgroundColor: "var(--sidebar)",
        color: "var(--nav-text)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <PanelLeft
        className="h-4 w-4"
        style={{ color: "var(--nav-text-secondary)" }}
      />
      <nav className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate" style={{ color: "var(--nav-text)" }}>
          {event.name}
        </span>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: "var(--nav-text-secondary)" }}
        />
        <span style={{ color: "var(--nav-text-secondary)" }}>Application</span>
      </nav>
      <div className="ml-auto flex items-center gap-1 text-sm">
        <Globe
          className="h-3.5 w-3.5"
          style={{ color: "var(--nav-text-secondary)" }}
        />
        <span style={{ color: "var(--nav-text)" }}>English</span>
      </div>
    </header>
  )
}
