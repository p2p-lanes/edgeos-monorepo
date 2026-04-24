import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { Suspense } from "react"

import { EmailTemplatesService } from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/email-templates/")({
  component: EmailTemplatesPage,
  head: () => ({
    meta: [{ title: "Email Templates - EdgeOS" }],
  }),
})

const CATEGORY_COLORS: Record<string, string> = {
  Auth: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Application:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  Payment: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
}

export function TemplateList() {
  const { selectedPopupId } = useWorkspace()

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

  const { data: tenantTemplates } = useQuery({
    queryKey: ["email-templates", "tenant"],
    queryFn: () => EmailTemplatesService.listEmailTemplates(),
  })

  const { data: popupTemplates } = useQuery({
    queryKey: ["email-templates", "popup", selectedPopupId],
    queryFn: () =>
      EmailTemplatesService.listEmailTemplates({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })

  if (!types) return <Skeleton className="h-64 w-full" />

  const tenantCustomTypeSet = new Set(
    tenantTemplates?.results?.map((t) => t.template_type) ?? [],
  )
  const popupCustomTypeSet = new Set(
    popupTemplates?.results?.map((t) => t.template_type) ?? [],
  )

  return (
    <div className="divide-y rounded-md border">
      {types.map((tmpl) => {
        const requiresPopup = tmpl.scope === "popup"
        const hasCustom = requiresPopup
          ? popupCustomTypeSet.has(tmpl.type)
          : tenantCustomTypeSet.has(tmpl.type)
        return (
          <div
            key={tmpl.type}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{tmpl.label}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {tmpl.description}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[tmpl.category] ?? ""}`}
              >
                {tmpl.category}
              </span>
              {hasCustom ? (
                <Badge variant="default">Custom</Badge>
              ) : (
                <Badge variant="secondary">Default</Badge>
              )}
              {requiresPopup && !selectedPopupId ? (
                <Button variant="ghost" size="sm" disabled>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Select popup to edit
                </Button>
              ) : (
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    to="/email-templates/$type/edit"
                    params={{ type: tmpl.type }}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmailTemplatesPage() {
  const { needsTenantSelection, needsPopupSelection } = useWorkspace()
  const { isAdmin } = useAuth()

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Email Templates</h1>
        <p className="text-muted-foreground">
          You need admin permissions to manage email templates.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {needsTenantSelection && <WorkspaceAlert resource="email templates" />}
      {needsPopupSelection && (
        <WorkspaceAlert resource="popup-scoped email templates" />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Templates</h1>
          <p className="text-muted-foreground">
            Customize the emails sent to applicants and attendees
          </p>
        </div>
      </div>
      {!needsTenantSelection && (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <TemplateList />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
