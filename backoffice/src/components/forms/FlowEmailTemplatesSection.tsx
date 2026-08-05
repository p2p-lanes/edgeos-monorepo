import { useQuery } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import type { EmailTemplateType } from "@/client"
import { EmailTemplatesService } from "@/client"
import { EmailTemplateEditor } from "@/components/EmailTemplateEditor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

interface FlowEmailTemplatesSectionProps {
  popupId: string
  flowId: string
}

/**
 * sdd/sales-flows task 14.1: lists the popup-scope email template types and
 * lets an operator open the flow's own tier (slice 10's three-tier
 * resolution: flow -> popup -> tenant/file) for any of them. Only
 * `scope === "popup"` types support a flow tier — tenant-scope auth emails
 * (login codes) have no flow to belong to and are excluded.
 */
export function FlowEmailTemplatesSection({
  popupId,
  flowId,
}: FlowEmailTemplatesSectionProps) {
  const [editingType, setEditingType] = useState<string | null>(null)

  const { data: types } = useQuery({
    queryKey: ["email-template-types"],
    queryFn: () => EmailTemplatesService.listTemplateTypes(),
  })

  const { data: popupTemplates, refetch } = useQuery({
    queryKey: ["email-templates", "popup", popupId],
    queryFn: () => EmailTemplatesService.listEmailTemplates({ popupId }),
  })

  if (!types) return <Skeleton className="h-32 w-full" />

  const popupScopeTypes = types.filter((t) => t.scope === "popup")
  const flowTemplateByType = new Map(
    (popupTemplates?.results ?? [])
      .filter((t) => t.sales_flow_id === flowId)
      .map((t) => [t.template_type, t]),
  )

  const editingTypeInfo = popupScopeTypes.find((t) => t.type === editingType)
  const existingTemplate = editingType
    ? flowTemplateByType.get(editingType)
    : undefined

  return (
    <div className="space-y-2">
      <div className="divide-y rounded-md border">
        {popupScopeTypes.map((tmpl) => {
          const custom = flowTemplateByType.get(tmpl.type)
          return (
            <div
              key={tmpl.type}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{tmpl.label}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {custom ? (
                  <Badge variant="default">Flow override</Badge>
                ) : (
                  <Badge variant="secondary">Inherited from event</Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingType(tmpl.type)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Dialog
        open={editingType !== null}
        onOpenChange={(open) => !open && setEditingType(null)}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogTitle>{editingTypeInfo?.label ?? "Edit Template"}</DialogTitle>
          <DialogDescription className="sr-only">
            Edit this flow's own version of the {editingTypeInfo?.label} email
            template
          </DialogDescription>
          {editingTypeInfo && (
            <EmailTemplateEditor
              templateType={editingType as EmailTemplateType}
              popupId={popupId}
              salesFlowId={flowId}
              existingTemplate={existingTemplate}
              typeInfo={editingTypeInfo}
              heightClassName="h-[75vh]"
              onSave={() => {
                refetch()
                setEditingType(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
