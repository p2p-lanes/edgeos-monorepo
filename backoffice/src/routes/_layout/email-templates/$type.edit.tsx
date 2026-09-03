import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { Suspense, useEffect } from "react"

import { EmailTemplatesService, type EmailTemplateType } from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EmailTemplateEditor } from "@/components/EmailTemplateEditor"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/email-templates/$type/edit")({
  component: EditEmailTemplate,
  // Which flow's copy is being edited. Mails a sale produces belong to the
  // flow that made the sale, so the URL has to say which one — otherwise a
  // link to this page means something different depending on who opens it.
  validateSearch: (search: Record<string, unknown>) => ({
    flow: typeof search.flow === "string" ? search.flow : undefined,
  }),
  head: () => ({
    meta: [{ title: "Edit Email Template - EdgeOS" }],
  }),
})

export function EditorContent({
  templateType,
  flowId,
}: {
  templateType: string
  flowId?: string
}) {
  const { selectedPopupId, effectiveTenantId } = useWorkspace()
  const navigate = useNavigate()

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

  const typeInfo = types?.find((t) => t.type === templateType)
  const isFlowScoped = typeInfo?.scope === "flow"
  const requiresPopup = isFlowScoped || typeInfo?.scope === "popup"

  const { data: customTemplates } = useQuery({
    queryKey: requiresPopup
      ? ["email-templates", "popup", effectiveTenantId, selectedPopupId]
      : ["email-templates", "tenant", effectiveTenantId],
    queryFn: () =>
      requiresPopup
        ? EmailTemplatesService.listEmailTemplates({
            popupId: selectedPopupId!,
          })
        : EmailTemplatesService.listEmailTemplates(),
    enabled: !!typeInfo && (!requiresPopup || !!selectedPopupId),
  })

  // Match the tier as well as the type. A flow's copy and the gathering's
  // copy are different rows, and picking the wrong one would edit somebody
  // else's mail.
  const existingTemplate = customTemplates?.results?.find(
    (t) =>
      t.template_type === templateType &&
      (isFlowScoped ? t.sales_flow_id === flowId : !t.sales_flow_id),
  )

  if (!types) return <Skeleton className="h-96 w-full" />
  if (!typeInfo) return <div>Unknown template type: {templateType}</div>
  if (requiresPopup && !selectedPopupId) {
    return <WorkspaceAlert resource="email templates" action="create" />
  }
  if (isFlowScoped && !flowId) {
    return (
      <p className="text-muted-foreground text-sm">
        Open this email from the list to choose which sales flow it is for.
      </p>
    )
  }
  if (!customTemplates) return <Skeleton className="h-96 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/email-templates">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {typeInfo.label}
          </h1>
          <p className="text-muted-foreground">{typeInfo.description}</p>
        </div>
      </div>

      <EmailTemplateEditor
        templateType={templateType as EmailTemplateType}
        popupId={requiresPopup ? selectedPopupId! : undefined}
        salesFlowId={isFlowScoped ? flowId : undefined}
        existingTemplate={existingTemplate}
        typeInfo={typeInfo}
        onSave={() => navigate({ to: "/email-templates" })}
      />
    </div>
  )
}

function EditEmailTemplate() {
  const { type } = Route.useParams()
  const { flow } = Route.useSearch()
  const { needsTenantSelection } = useWorkspace()
  const { isOperatorOrAbove, isUserLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/email-templates" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  if (needsTenantSelection) {
    return (
      <div className="flex flex-col gap-6">
        <WorkspaceAlert resource="email templates" action="create" />
      </div>
    )
  }

  return (
    <QueryErrorBoundary>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <EditorContent templateType={type} flowId={flow} />
      </Suspense>
    </QueryErrorBoundary>
  )
}
