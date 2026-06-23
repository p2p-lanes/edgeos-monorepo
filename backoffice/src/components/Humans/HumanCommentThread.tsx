import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { type HumanCommentPublic, HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

function commentsQueryKey(humanId: string) {
  return ["human-comments", humanId]
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString()
}

function CommentRow({
  humanId,
  comment,
}: {
  humanId: string
  comment: HumanCommentPublic
}) {
  const queryClient = useQueryClient()
  const { user, isSuperadmin } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  const isOwn = !!user && comment.author_user_id === user.id
  // Editing stays author-only (the backend rejects editing others' comments),
  // but superadmins can delete any comment for moderation — mirrors the
  // backend's delete-comment policy (author OR superadmin).
  const canDelete = isOwn || isSuperadmin

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: commentsQueryKey(humanId) })

  const updateMutation = useMutation({
    mutationFn: () =>
      HumansService.updateHumanComment({
        humanId,
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
      HumansService.deleteHumanComment({ humanId, commentId: comment.id }),
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
        <div
          className={
            "text-sm text-foreground/90 " +
            "[&>p]:my-0 [&>p]:whitespace-pre-wrap [&>p+p]:mt-2 " +
            "[&>ul]:my-1 [&>ul]:list-disc [&>ul]:pl-5 " +
            "[&>ol]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 " +
            "[&_li]:my-0.5 " +
            "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1 " +
            "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 " +
            "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
            "[&_strong]:font-semibold [&_em]:italic " +
            "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
            "[&_a]:text-primary [&_a]:underline"
          }
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {comment.body}
          </ReactMarkdown>
        </div>
      )}

      {canDelete && !editing && (
        <div className="mt-2 flex gap-1">
          {isOwn && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-muted-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-muted-foreground"
              onClick={() => {
                // A superadmin deleting someone else's comment is a moderation
                // action — confirm so it isn't a stray click. Deleting your own
                // stays one-click, matching the prior behavior.
                if (!isOwn && !window.confirm("Delete this comment?")) return
                deleteMutation.mutate()
              }}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Delete
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function HumanCommentThread({ humanId }: { humanId: string }) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [body, setBody] = useState("")

  const { data } = useQuery({
    queryKey: commentsQueryKey(humanId),
    queryFn: () => HumansService.listHumanComments({ humanId }),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      HumansService.createHumanComment({ humanId, requestBody: { body } }),
    onSuccess: () => {
      setBody("")
      queryClient.invalidateQueries({ queryKey: commentsQueryKey(humanId) })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const comments = data?.results ?? []

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Comments {comments.length > 0 ? `(${comments.length})` : ""}
      </h3>
      <p className="text-sm text-muted-foreground">
        Notes that justify this person's rating. Visible to the team.
      </p>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentRow key={c.id} humanId={humanId} comment={c} />
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
