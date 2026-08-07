import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { Suspense, useEffect, useState } from "react"

import { EmailTemplatesService, SalesFlowsService } from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FlowScopePicker } from "@/components/EmailTemplates/FlowScopePicker"
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

export function TemplateList() {
  const { selectedPopupId, effectiveTenantId } = useWorkspace()
  const [flowId, setFlowId] = useState<string>()

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

  const { data: flows } = useQuery({
    queryKey: ["sales-flows", { popupId: selectedPopupId }],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({
        popupId: selectedPopupId!,
        limit: 100,
      }),
    enabled: !!selectedPopupId,
  })

  // Land on the default flow so the page is never showing nobody's mails.
  useEffect(() => {
    if (flowId || !flows?.results?.length) return
    const fallback = flows.results.find((f) => f.is_default) ?? flows.results[0]
    setFlowId(fallback.id)
  }, [flows, flowId])

  const { data: tenantTemplates } = useQuery({
    queryKey: ["email-templates", "tenant", effectiveTenantId],
    queryFn: () => EmailTemplatesService.listEmailTemplates(),
  })

  const { data: popupTemplates } = useQuery({
    queryKey: ["email-templates", "popup", effectiveTenantId, selectedPopupId],
    queryFn: () =>
      EmailTemplatesService.listEmailTemplates({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })

  if (!types) return <Skeleton className="h-64 w-full" />

  const tenantCustomByType = new Map(
    tenantTemplates?.results?.map((t) => [t.template_type, t]) ?? [],
  )
  // Split by tier: a row carrying a flow answers only for that flow, and a
  // row without one answers only for the gathering. Reading either through
  // the other is the mix-up this page used to show.
  const popupRows = popupTemplates?.results ?? []
  const popupCustomByType = new Map(
    popupRows.filter((t) => !t.sales_flow_id).map((t) => [t.template_type, t]),
  )
  const flowCustomByType = new Map(
    popupRows
      .filter((t) => t.sales_flow_id === flowId)
      .map((t) => [t.template_type, t]),
  )

  // Group by category, preserving the backend metadata order.
  const categories: string[] = []
  const byCategory = new Map<string, typeof types>()
  for (const tmpl of types) {
    const group = byCategory.get(tmpl.category)
    if (group) {
      group.push(tmpl)
    } else {
      categories.push(tmpl.category)
      byCategory.set(tmpl.category, [tmpl])
    }
  }

  return (
    <div className="space-y-6">
      {selectedPopupId && (
        <FlowScopePicker
          popupId={selectedPopupId}
          value={flowId}
          onChange={setFlowId}
        />
      )}
      {categories.map((category) => (
        <div key={category} className="space-y-1">
          <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {category}
          </h3>
          <div className="divide-y rounded-md border">
            {(byCategory.get(category) ?? []).map((tmpl) => {
              const isFlowScoped = tmpl.scope === "flow"
              const requiresPopup = isFlowScoped || tmpl.scope === "popup"
              // Without a gathering selected we cannot know whether a
              // gathering-scoped template is customized, so show no badge.
              // Same for a flow-scoped one before a flow is chosen.
              const customUnknown =
                (requiresPopup && !selectedPopupId) || (isFlowScoped && !flowId)
              const custom = isFlowScoped
                ? flowCustomByType.get(tmpl.type)
                : requiresPopup
                  ? popupCustomByType.get(tmpl.type)
                  : tenantCustomByType.get(tmpl.type)
              return (
                <div
                  key={tmpl.type}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {tmpl.label}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {tmpl.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!customUnknown &&
                      (custom ? (
                        custom.is_active ? (
                          <Badge variant="default">Custom</Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-transparent bg-warning-soft text-warning"
                          >
                            Custom - inactive
                          </Badge>
                        )
                      ) : (
                        <Badge variant="secondary">Default</Badge>
                      ))}
                    {customUnknown ? (
                      <Button variant="ghost" size="sm" disabled>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Select gathering to edit
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/email-templates/$type/edit"
                          params={{ type: tmpl.type }}
                          search={{ flow: isFlowScoped ? flowId : undefined }}
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
        </div>
      ))}
    </div>
  )
}

export function EmailTemplatesPage() {
  const { needsTenantSelection, needsPopupSelection } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()

  if (!isOperatorOrAbove) {
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
        <WorkspaceAlert resource="gathering-scoped email templates" />
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
