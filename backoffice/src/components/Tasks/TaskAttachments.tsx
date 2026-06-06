import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  type TaskAttachmentCreate,
  type TaskAttachmentPublic,
  TasksService,
} from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { AttachmentField } from "./AttachmentField"
import { AttachmentGrid } from "./AttachmentGrid"

interface TaskAttachmentsProps {
  taskId: string
  attachments: TaskAttachmentPublic[]
}

/** Attachment manager for an existing task (edit mode): view, add, remove. */
export function TaskAttachments({ taskId, attachments }: TaskAttachmentsProps) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] })
    queryClient.invalidateQueries({ queryKey: ["tasks"] })
  }

  const addMutation = useMutation({
    mutationFn: (attachment: TaskAttachmentCreate) =>
      TasksService.addAttachment({ taskId, requestBody: attachment }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      TasksService.deleteAttachment({ taskId, attachmentId }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Attachments {attachments.length > 0 ? `(${attachments.length})` : ""}
      </h3>
      <AttachmentGrid
        items={attachments}
        onRemove={(index) => deleteMutation.mutate(attachments[index].id)}
      />
      <AttachmentField
        onUploaded={(attachment) => addMutation.mutate(attachment)}
        disabled={addMutation.isPending}
      />
    </div>
  )
}
