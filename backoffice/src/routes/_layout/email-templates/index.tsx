import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { Suspense, useCallback } from "react"

import { EmailTemplatesService, type SalesFlowPublic } from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FlowScopeBar } from "@/components/SalesFlows/FlowScopeBar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { rememberFlow, useFlowScope } from "@/hooks/useFlowScope"

export const Route = createFileRoute("/_layout/email-templates/")({
  component: EmailTemplatesPage,
  // The sale mails on this page belong to one flow, so the address names
  // it. The gathering mails below them do not move with it.
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.flow === "string" && raw.flow ? { flow: raw.flow } : {}),
  }),
  head: () => ({
    meta: [{ title: "Email Templates - EdgeOS" }],
  }),
})

interface TemplateListProps {
  /** Whose sale mails are on screen. The route resolves it from the URL. */
  flowId?: string
  flows?: SalesFlowPublic[]
  onSelectFlow?: (flowId: string) => void
  flowsLoading?: boolean
}

export function TemplateList({
  flowId,
  flows = [],
  onSelectFlow,
  flowsLoading = false,
}: TemplateListProps = {}) {
  const { selectedPopupId, effectiveTenantId } = useWorkspace()

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

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
        <FlowScopeBar
          popupId={selectedPopupId}
          flows={flows}
          activeFlowId={flowId}
          onSelect={(nextFlowId: string) => onSelectFlow?.(nextFlowId)}
          isLoading={flowsLoading}
          resource="sale emails"
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
  const { needsTenantSelection, needsPopupSelection, selectedPopupId } =
    useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const navigate = useNavigate()
  const { flow: flowParam } = Route.useSearch()

  // The route owns the address. TemplateList only renders what it is given,
  // which is also why it can be tested without a router around it.
  const adoptFlow = useCallback(
    (nextFlowId: string) => {
      navigate({
        to: "/email-templates",
        search: { flow: nextFlowId },
        replace: true,
      })
    },
    [navigate],
  )
  const {
    flows,
    activeFlowId,
    isLoading: flowsLoading,
  } = useFlowScope(selectedPopupId ?? undefined, flowParam, adoptFlow)

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
            <TemplateList
              flowId={activeFlowId}
              flows={flows}
              flowsLoading={flowsLoading}
              onSelectFlow={(nextFlowId) => {
                if (selectedPopupId) rememberFlow(selectedPopupId, nextFlowId)
                navigate({
                  to: "/email-templates",
                  search: { flow: nextFlowId },
                })
              }}
            />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
