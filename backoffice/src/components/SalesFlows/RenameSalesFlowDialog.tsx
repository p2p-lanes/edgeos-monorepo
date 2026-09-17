import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useId, useState } from "react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export function RenameSalesFlowDialog({ flow }: { flow: SalesFlowPublic }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(flow.name)
  const inputId = useId()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const trimmedName = name.trim()

  const mutation = useMutation({
    mutationFn: (newName: string) =>
      SalesFlowsService.updateSalesFlow({
        flowId: flow.id,
        requestBody: { name: newName },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      showSuccessToast("Sales flow renamed successfully")
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (mutation.isPending) return
        if (nextOpen) setName(flow.name)
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Rename ${flow.name}`}>
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !trimmedName ||
              trimmedName === flow.name ||
              mutation.isPending
            ) {
              return
            }
            mutation.mutate(trimmedName)
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Rename sales flow</DialogTitle>
            <DialogDescription>
              Choose a new name for {flow.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={mutation.isPending}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              disabled={!trimmedName || trimmedName === flow.name}
            >
              Save name
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
