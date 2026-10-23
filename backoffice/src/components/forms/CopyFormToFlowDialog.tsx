import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Copy } from "lucide-react"
import { useState } from "react"
import {
  FormFieldsService,
  type SalesFlowPublic,
  type SalesFlowType,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface CopyFormToFlowDialogProps {
  popupId: string
  targetFlowId: string
  targetFlowType: SalesFlowType
  flows: SalesFlowPublic[]
}

/**
 * sdd/sales-flows task 14.4: backoffice UI for the copy-form-to-flow action
 * (backend built in slice 6, exposed over HTTP in task 14.1). Copies
 * sections + base field configs + custom fields from another flow
 * into this flow as
 * independent rows — the target ends up owning its own copy; editing
 * either afterward never affects the other.
 */
export function CopyFormToFlowDialog({
  popupId,
  targetFlowId,
  targetFlowType,
  flows,
}: CopyFormToFlowDialogProps) {
  const [open, setOpen] = useState(false)
  const [sourceFlowId, setSourceFlowId] = useState<string>("")
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const otherFlows = flows.filter(
    (flow) => flow.id !== targetFlowId && flow.type === targetFlowType,
  )
  const selectedSourceFlowId = otherFlows.some(
    (flow) => flow.id === sourceFlowId,
  )
    ? sourceFlowId
    : otherFlows[0]?.id

  const copyMutation = useMutation({
    mutationFn: () =>
      FormFieldsService.copyFormToFlow({
        targetFlowId,
        requestBody: {
          source_flow_id: selectedSourceFlowId,
        },
      }),
    onSuccess: (result) => {
      showSuccessToast(
        `Copied ${result.sections} section(s), ${result.base_fields} base field(s), and ${result.fields} custom field(s)`,
      )
      queryClient.invalidateQueries({
        queryKey: ["form-fields", popupId, targetFlowId],
      })
      queryClient.invalidateQueries({
        queryKey: ["form-sections", popupId, targetFlowId],
      })
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!selectedSourceFlowId) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy form from...
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy Form to This Flow</DialogTitle>
          <DialogDescription>
            This replaces this flow's own form with an independent copy of the
            selected source. Editing either afterward never affects the other.
          </DialogDescription>
        </DialogHeader>
        <Select value={selectedSourceFlowId} onValueChange={setSourceFlowId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {otherFlows.map((flow) => (
              <SelectItem key={flow.id} value={flow.id}>
                {flow.name}
                {flow.is_default ? " (primary flow)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <LoadingButton
            loading={copyMutation.isPending}
            disabled={!selectedSourceFlowId}
            onClick={() => copyMutation.mutate()}
          >
            Copy
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
