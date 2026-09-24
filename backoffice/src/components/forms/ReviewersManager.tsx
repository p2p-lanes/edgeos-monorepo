import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, UserPlus } from "lucide-react"
import type * as React from "react"
import { useState } from "react"

import {
  type ApiError,
  type PopupReviewerCreate,
  type PopupReviewerPublic,
  PopupReviewersService,
  UsersService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

interface ReviewersManagerProps {
  popupId: string
  tenantId: string
  readOnly?: boolean
  variant?: "card" | "inline"
  /**
   * sdd/sales-flows task 14.1: scopes this manager to one flow's tri-state
   * reviewer resolution (design D4). Omitted keeps the popup-shared tier
   * exactly as before this slice. When given, `listReviewers` returns the
   * RESOLVED set (inherit -> popup-shared tier; override -> the flow's own
   * rows, possibly empty) and add/remove act on that flow's tier — adding a
   * reviewer here flips the flow to override automatically; removing the
   * last one resets it back to inherit (both server-side invariants, no
   * client-side mode bookkeeping needed).
   */
  flowId?: string
  reviewersMode?: "inherit" | "override"
}

export function ReviewersManager({
  popupId,
  tenantId,
  readOnly = false,
  variant = "card",
  flowId,
  reviewersMode,
}: ReviewersManagerProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [reviewerToRemove, setReviewerToRemove] =
    useState<PopupReviewerPublic | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [isRequired, setIsRequired] = useState(false)

  const queryKey = flowId
    ? ["popup-reviewers", popupId, "flow", flowId]
    : ["popup-reviewers", popupId]

  // Fetch current reviewers
  const {
    data: reviewersData,
    isLoading: loadingReviewers,
    isError: _reviewersError,
  } = useQuery({
    queryKey,
    queryFn: () =>
      PopupReviewersService.listReviewers({ popupId, salesFlowId: flowId }),
  })

  // Fetch users that can be reviewers (admin role in this tenant)
  const {
    data: usersData,
    isLoading: loadingUsers,
    isError: _usersError,
  } = useQuery({
    queryKey: ["users", tenantId, "admin"],
    queryFn: () =>
      UsersService.listUsers({ tenantId, role: "admin", limit: 100 }),
  })

  const reviewers = reviewersData?.results ?? []
  const users = usersData?.results ?? []

  // Inherited reviewers can also be assigned to the flow's own list.
  const availableUsers = users.filter(
    (user) =>
      !reviewers.some(
        (r) =>
          r.user_id === user.id &&
          (r.sales_flow_id ?? null) === (flowId ?? null),
      ),
  )

  const addMutation = useMutation({
    mutationFn: (data: PopupReviewerCreate) =>
      PopupReviewersService.addReviewer({ popupId, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Reviewer added")
      queryClient.invalidateQueries({ queryKey: ["popup-reviewers", popupId] })
      if (flowId) {
        queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      }
      queryClient.invalidateQueries({
        queryKey: ["applications", popupId, "reviewers"],
      })
      setIsAddDialogOpen(false)
      setSelectedUserId("")
      setIsRequired(false)
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      PopupReviewersService.removeReviewer({
        popupId,
        userId,
        salesFlowId: flowId,
      }),
    onSuccess: () => {
      showSuccessToast("Reviewer removed")
      setReviewerToRemove(null)
      queryClient.invalidateQueries({ queryKey: ["popup-reviewers", popupId] })
      if (flowId) {
        queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      }
      queryClient.invalidateQueries({
        queryKey: ["applications", popupId, "reviewers"],
      })
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const handleAddReviewer = () => {
    if (!selectedUserId) return
    addMutation.mutate({
      user_id: selectedUserId,
      sales_flow_id: flowId,
      is_required: isRequired,
      weight_multiplier: 1.0,
    })
  }

  if (loadingReviewers) {
    return (
      <SectionShell
        variant={variant}
        title="Reviewers"
        description="Loading..."
      >
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </SectionShell>
    )
  }

  return (
    <>
      <SectionShell
        variant={variant}
        title="Reviewers"
        description={
          flowId && reviewersMode === "inherit"
            ? "Inherited from the event. Adding a reviewer here switches this flow to its own reviewer list."
            : flowId
              ? "This flow's own reviewer list. Remove all reviewers to inherit from the event again."
              : "Users who can review and approve applications for this gathering"
        }
        action={
          !readOnly && availableUsers.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddDialogOpen(true)}
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Add Reviewer
            </Button>
          ) : undefined
        }
      >
        {reviewers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviewers assigned. Any admin user can review applications.
          </p>
        ) : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {reviewers.map((reviewer) => (
              <ReviewerRow
                key={reviewer.id}
                reviewer={reviewer}
                onRemove={() => setReviewerToRemove(reviewer)}
                isRemoving={removeMutation.isPending}
                readOnly={
                  readOnly || (!!flowId && reviewer.sales_flow_id !== flowId)
                }
              />
            ))}
          </div>
        )}
      </SectionShell>

      <Dialog
        open={reviewerToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removeMutation.isPending) setReviewerToRemove(null)
        }}
      >
        <DialogContent showCloseButton={!removeMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Remove Reviewer</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              {reviewerToRemove?.user_full_name ||
                reviewerToRemove?.user_email ||
                "this user"}{" "}
              as a reviewer?
              {flowId && reviewers.length === 1 && (
                <> This flow will inherit the event's reviewers again.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removeMutation.isPending}
              onClick={() => setReviewerToRemove(null)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={removeMutation.isPending}
              onClick={() => {
                if (reviewerToRemove) {
                  removeMutation.mutate(reviewerToRemove.user_id)
                }
              }}
            >
              Remove Reviewer
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Reviewer Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Reviewer</DialogTitle>
            <DialogDescription>
              {flowId
                ? "Select a user to designate as a reviewer for this sales flow. Changes are saved immediately."
                : "Select a user to designate as a reviewer for this popup."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="user">User</Label>
              {loadingUsers ? (
                <Skeleton className="h-10 w-full" />
              ) : availableUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No available admin users to add as reviewers.
                </p>
              ) : (
                <Select
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                >
                  <SelectTrigger id="user">
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.full_name || user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="is_required">Required Reviewer</Label>
                <p className="text-sm text-muted-foreground">
                  This reviewer must approve for "All Reviewers" strategy
                </p>
              </div>
              <Switch
                id="is_required"
                checked={isRequired}
                onCheckedChange={setIsRequired}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddReviewer}
              disabled={!selectedUserId || addMutation.isPending}
            >
              {addMutation.isPending ? "Adding..." : "Add Reviewer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ReviewerRowProps {
  reviewer: PopupReviewerPublic
  onRemove: () => void
  isRemoving: boolean
  readOnly: boolean
}

function ReviewerRow({
  reviewer,
  onRemove,
  isRemoving,
  readOnly,
}: ReviewerRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-sm font-medium">
            {(reviewer.user_full_name || reviewer.user_email || "?")
              .charAt(0)
              .toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-medium">
            {reviewer.user_full_name || reviewer.user_email || "Unknown User"}
          </p>
          {reviewer.user_full_name && reviewer.user_email && (
            <p className="text-xs text-muted-foreground">
              {reviewer.user_email}
            </p>
          )}
        </div>
        {reviewer.is_required && (
          <Badge variant="secondary" className="ml-2">
            Required
          </Badge>
        )}
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-label="Remove reviewer"
          onClick={onRemove}
          disabled={isRemoving}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function SectionShell({
  variant,
  title,
  description,
  action,
  children,
}: {
  variant: "card" | "inline"
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  if (variant === "inline") {
    return (
      <div className="space-y-4">
        <div
          className={cn("flex items-start justify-between", action && "gap-4")}
        >
          <div className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
        {children}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div
          className={cn("flex items-start justify-between", action && "gap-4")}
        >
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
