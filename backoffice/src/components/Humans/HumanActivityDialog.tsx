import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface HumanActivityDialogProps {
  humanId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Today at noon as a "YYYY-MM-DDTHH:mm" seed for the datetime picker. */
function defaultPickerValue(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}T12:00`
}

/**
 * Admin-only dialog to add a manual note to a human's activity timeline at a
 * chosen date/time. Mirrors the TaskDialog mutation/toast pattern.
 */
export function HumanActivityDialog({
  humanId,
  open,
  onOpenChange,
}: HumanActivityDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [note, setNote] = useState("")
  const [occurredAt, setOccurredAt] = useState(defaultPickerValue)

  const reset = () => {
    setNote("")
    setOccurredAt(defaultPickerValue())
  }

  const mutation = useMutation({
    mutationFn: () =>
      HumansService.createHumanActivity({
        humanId,
        // Picker value is local time; convert to a UTC ISO instant so the
        // backend sorts it at the chosen point in the timeline.
        requestBody: {
          note: note.trim(),
          occurred_at: new Date(occurredAt).toISOString(),
        },
      }),
    onSuccess: () => {
      showSuccessToast("Activity added")
      queryClient.invalidateQueries({
        queryKey: ["human-activity", humanId],
      })
      reset()
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleSave = () => {
    if (!note.trim()) {
      showErrorToast("Note is required")
      return
    }
    if (!occurredAt) {
      showErrorToast("Pick a date & time")
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add activity</DialogTitle>
          <DialogDescription>
            Record something this human did, at the time it happened.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="activity-occurred-at">When</Label>
            <DateTimePicker
              id="activity-occurred-at"
              value={occurredAt}
              onChange={setOccurredAt}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="activity-note">Note</Label>
            <Textarea
              id="activity-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did they do?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton loading={mutation.isPending} onClick={handleSave}>
            Add activity
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
