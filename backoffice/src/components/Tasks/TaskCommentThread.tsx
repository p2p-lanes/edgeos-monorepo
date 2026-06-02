import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"

import { type TaskCommentPublic, TasksService } from "@/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

function commentsQueryKey(taskId: string) {
  return ["task-comments", taskId]
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString()
}

function CommentRow({
  taskId,
  comment,
}: {
  taskId: string
  comment: TaskCommentPublic
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  const isOwn = !!user && comment.author_user_id === user.id

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: commentsQueryKey(taskId) })

  const updateMutation = useMutation({
    mutationFn: () =>
      TasksService.updateTaskComment({
        taskId,
        commentId: comment.id,
        requestBody: { body: draft },
      }),
    onSuccess: () => {
      setEditing(false)
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      TasksService.deleteTaskComment({ taskId, commentId: comment.id }),
    onSuccess: () => {
      showSuccessToast("Comment deleted")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {comment.author_name || comment.author_email || "Unknown"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatWhen(comment.created_at)}
          {comment.edited_at ? " · edited" : ""}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <LoadingButton
              size="sm"
              loading={updateMutation.isPending}
              disabled={!draft.trim()}
              onClick={() => updateMutation.mutate()}
            >
              Save
            </LoadingButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(comment.body)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground/90">
          {comment.body}
        </p>
      )}

      {isOwn && !editing && (
        <div className="mt-2 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1 h-3 w-3" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
        </div>
      )}
    </div>
  )
}

export function TaskCommentThread({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [body, setBody] = useState("")

  const { data } = useQuery({
    queryKey: commentsQueryKey(taskId),
    queryFn: () => TasksService.listTaskComments({ taskId }),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      TasksService.createTaskComment({ taskId, requestBody: { body } }),
    onSuccess: () => {
      setBody("")
      queryClient.invalidateQueries({ queryKey: commentsQueryKey(taskId) })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const comments = data?.results ?? []

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Comments {comments.length > 0 ? `(${comments.length})` : ""}
      </h3>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentRow key={c.id} taskId={taskId} comment={c} />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Textarea
          rows={3}
          placeholder="Write a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <LoadingButton
          size="sm"
          loading={createMutation.isPending}
          disabled={!body.trim()}
          onClick={() => createMutation.mutate()}
        >
          Comment
        </LoadingButton>
      </div>
    </div>
  )
}
