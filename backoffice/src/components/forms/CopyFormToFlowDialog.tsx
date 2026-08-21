import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy } from "lucide-react"
import { useEffect, useState } from "react"
import {
  FormFieldsService,
  SalesFlowsService,
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
import { salesFlowsQueryKey } from "@/lib/salesFlowQueries"
import { createErrorHandler } from "@/utils"

const SHARED_TIER_VALUE = "__shared__"

interface CopyFormToFlowDialogProps {
  popupId: string
  targetFlowId: string
  targetFlowType: SalesFlowType
}

/**
 * sdd/sales-flows task 14.4: backoffice UI for the copy-form-to-flow action
 * (backend built in slice 6, exposed over HTTP in task 14.1). Copies
 * sections + base field configs + custom fields from a source (the
 * popup-shared tier, or a sibling flow's own rows) into this flow as
 * independent rows — the target ends up owning its own copy; editing
 * either afterward never affects the other.
 */
export function CopyFormToFlowDialog({
  popupId,
  targetFlowId,
  targetFlowType,
}: CopyFormToFlowDialogProps) {
  const [open, setOpen] = useState(false)
  const [sourceFlowId, setSourceFlowId] = useState<string>(SHARED_TIER_VALUE)
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const { data: flows } = useQuery({
    queryKey: salesFlowsQueryKey(popupId),
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId }),
    enabled: open,
  })

  const defaultFlow = (flows?.results ?? []).find(
    (flow) => flow.is_default && flow.type === targetFlowType,
  )
  const otherFlows = (flows?.results ?? []).filter(
    (flow) =>
      flow.id !== targetFlowId &&
      flow.id !== defaultFlow?.id &&
      flow.type === targetFlowType,
  )

  useEffect(() => {
    if (!flows) return
    if (defaultFlow || sourceFlowId !== SHARED_TIER_VALUE) return
    setSourceFlowId(otherFlows[0]?.id ?? "")
  }, [defaultFlow, flows, otherFlows, sourceFlowId])

  const copyMutation = useMutation({
    mutationFn: () =>
      FormFieldsService.copyFormToFlow({
        targetFlowId,
        requestBody: {
          source_flow_id:
            sourceFlowId === SHARED_TIER_VALUE ? null : sourceFlowId,
        },
      }),
    onSuccess: (result) => {
      showSuccessToast(
        `Copied ${result.sections} section(s), ${result.base_fields} base field(s), and ${result.fields} custom field(s)`,
      )
      queryClient.invalidateQueries({ queryKey: ["form-schema", targetFlowId] })
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

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
        <Select value={sourceFlowId} onValueChange={setSourceFlowId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {defaultFlow && (
              <SelectItem value={SHARED_TIER_VALUE}>
                Event's shared form
              </SelectItem>
            )}
            {otherFlows.map((flow) => (
              <SelectItem key={flow.id} value={flow.id}>
                {flow.name}
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
            disabled={
              !sourceFlowId ||
              (sourceFlowId === SHARED_TIER_VALUE && !defaultFlow)
            }
            onClick={() => copyMutation.mutate()}
          >
            Copy
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
