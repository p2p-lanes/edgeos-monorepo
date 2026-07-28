import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { ApplicationsService, type HumanPublic, PopupsService } from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"

/**
 * "Applications" panel — every application this person submitted, each linking
 * to its detail where the full, popup-specific form answers live. We do NOT
 * dump one application's answers inline: a human can apply to several popups, so
 * an inline dump is ambiguous and just duplicates the editable profile fields
 * shown above on this page.
 */

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()
}

export function DeclaredFieldsCard({ human }: { human: HumanPublic }) {
  const { data: appsData, isPending } = useQuery({
    queryKey: ["human-applications", human.id],
    queryFn: () =>
      ApplicationsService.listApplications({ humanId: human.id, limit: 100 }),
  })

  const { data: popupsData } = useQuery({
    queryKey: ["popups"],
    queryFn: () => PopupsService.listPopups(),
  })

  const popupName = new Map(
    (popupsData?.results ?? []).map((p) => [p.id, p.name] as const),
  )

  const applications = [...(appsData?.results ?? [])].sort((a, b) => {
    const da = new Date(a.submitted_at ?? a.created_at ?? 0).getTime()
    const db = new Date(b.submitted_at ?? b.created_at ?? 0).getTime()
    return db - da
  })

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (applications.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This person hasn't submitted any applications yet.
      </p>
    )
  }

  return (
    <div className="divide-y overflow-hidden rounded-md border">
      {applications.map((app) => (
        <Link
          key={app.id}
          to="/applications/$id"
          params={{ id: app.id }}
          className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {popupName.get(app.popup_id) ?? "Application"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(app.submitted_at ?? app.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={app.status} />
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Link>
      ))}
    </div>
  )
}
