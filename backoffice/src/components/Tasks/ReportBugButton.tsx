import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bug } from "lucide-react"
import { useState } from "react"

import { type TaskAttachmentCreate, TasksService } from "@/client"
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
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { AttachmentField } from "./AttachmentField"
import { AttachmentGrid } from "./AttachmentGrid"

const DETAIL_GUIDE = `Help us reproduce it:
1. What you did (steps).
2. What you expected to happen.
3. What happened instead.
4. Where it happened (page / URL).`

/**
 * "Report a bug" — available to every backoffice user. Files an internal bug
 * via the open report endpoint, with optional screenshots / screen-recordings.
 */
export function ReportBugButton() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [detail, setDetail] = useState("")
  const [attachments, setAttachments] = useState<TaskAttachmentCreate[]>([])

  const reset = () => {
    setTitle("")
    setDetail("")
    setAttachments([])
  }

  const mutation = useMutation({
    mutationFn: () =>
      TasksService.reportBug({
        requestBody: {
          title: title.trim(),
          detail: detail.trim() || null,
          attachments,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Thanks! Your bug report was submitted.")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      reset()
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleSubmit = () => {
    if (!title.trim()) {
      showErrorToast("Please add a short title")
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start group-data-[collapsible=icon]:justify-center"
        >
          <Bug className="h-4 w-4 group-data-[collapsible=icon]:mr-0 sm:mr-2" />
          <span className="group-data-[collapsible=icon]:hidden">
            Report a bug
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="thin-scrollbar max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. The team reviews every report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bug-title">Title</Label>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Checkout total is wrong when applying a coupon"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bug-detail">Description</Label>
            <Textarea
              id="bug-detail"
              rows={6}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={DETAIL_GUIDE}
            />
            <p className="text-xs text-muted-foreground">
              A good report has steps to reproduce, expected vs. actual result,
              and where it happened. Screenshots or a screen recording help a
              lot.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Attachments</Label>
            <AttachmentGrid
              items={attachments}
              onRemove={(index) =>
                setAttachments((prev) => prev.filter((_, i) => i !== index))
              }
            />
            <AttachmentField
              onUploaded={(attachment) =>
                setAttachments((prev) => [...prev, attachment])
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <LoadingButton loading={mutation.isPending} onClick={handleSubmit}>
            Submit report
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
