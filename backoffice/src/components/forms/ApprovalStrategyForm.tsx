import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, Trash2 } from "lucide-react"

import {
  type ApiError,
  ApprovalStrategiesService,
  type ApprovalStrategyCreate,
  type ApprovalStrategyPublic,
} from "@/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { handleError } from "@/utils"

interface ApprovalStrategyFormProps {
  popupId: string
  readOnly?: boolean
}

const STRATEGY_TYPES = [
  {
    value: "auto_accept",
    label: "Auto Accept",
    description: "Applications are automatically accepted on submission",
  },
  {
    value: "any_reviewer",
    label: "Any Reviewer",
    description: "Any single designated reviewer can accept an application",
  },
  {
    value: "all_reviewers",
    label: "All Reviewers",
    description: "All required reviewers must approve for acceptance",
  },
  {
    value: "threshold",
    label: "Threshold",
    description: "A specific number of approvals is required",
  },
  {
    value: "weighted",
    label: "Weighted Voting",
    description:
      "Reviewers vote with different weights (strong yes, yes, no, strong no)",
  },
] as const

type StrategyType = (typeof STRATEGY_TYPES)[number]["value"]

export function ApprovalStrategyForm({
  popupId,
  readOnly = false,
}: ApprovalStrategyFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const {
    data: strategy,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["approval-strategy", popupId],
    queryFn: () => ApprovalStrategiesService.getApprovalStrategy({ popupId }),
    retry: false,
  })

  // Check if no strategy exists (404 error)
  const hasNoStrategy = !strategy && (error as ApiError)?.status === 404

  const saveMutation = useMutation({
    mutationFn: (data: ApprovalStrategyCreate) =>
      ApprovalStrategiesService.createOrUpdateApprovalStrategy({
        popupId,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Approval strategy saved")
      queryClient.invalidateQueries({
        queryKey: ["approval-strategy", popupId],
      })
    },
    onError: (err) => handleError.call(showErrorToast, err as ApiError),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      ApprovalStrategiesService.deleteApprovalStrategy({ popupId }),
    onSuccess: () => {
      showSuccessToast("Approval strategy removed (auto-accept enabled)")
      queryClient.invalidateQueries({
        queryKey: ["approval-strategy", popupId],
      })
    },
    onError: (err) => handleError.call(showErrorToast, err as ApiError),
  })

  if (isLoading) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Application Review</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    )
  }

  // No strategy configured - show simple state with option to enable
  if (hasNoStrategy) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Application Review</CardTitle>
          <CardDescription>
            Configure how applications are reviewed before acceptance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Applications are currently <strong>auto-accepted</strong> when
              submitted. Configure a review strategy below to require manual
              approval.
            </AlertDescription>
          </Alert>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                saveMutation.mutate({ strategy_type: "any_reviewer" })
              }
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? "Enabling..."
                : "Enable Application Review"}
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  // Strategy exists - render the form with loaded data
  return (
    <ApprovalStrategyFormInner
      strategy={strategy!}
      readOnly={readOnly}
      onSave={(data) => saveMutation.mutate(data)}
      onDelete={() => deleteMutation.mutate()}
      isSaving={saveMutation.isPending}
      isDeleting={deleteMutation.isPending}
    />
  )
}

// Inner component that only renders when strategy data is available
function ApprovalStrategyFormInner({
  strategy,
  readOnly,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: {
  strategy: ApprovalStrategyPublic
  readOnly: boolean
  onSave: (data: ApprovalStrategyCreate) => void
  onDelete: () => void
  isSaving: boolean
  isDeleting: boolean
}) {
  const form = useForm({
    defaultValues: {
      strategy_type: strategy.strategy_type as StrategyType,
      required_approvals: strategy.required_approvals,
      accept_threshold: strategy.accept_threshold,
      reject_threshold: strategy.reject_threshold,
      strong_yes_weight: strategy.strong_yes_weight,
      yes_weight: strategy.yes_weight,
      no_weight: strategy.no_weight,
      strong_no_weight: strategy.strong_no_weight,
      rejection_is_veto: strategy.rejection_is_veto,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      onSave(value)
    },
  })

  // Auto-save on blur
  const handleFieldBlur = () => {
    if (!readOnly) {
      form.handleSubmit()
    }
  }

  const strategyType = form.getFieldValue("strategy_type")
  const selectedStrategy = STRATEGY_TYPES.find((s) => s.value === strategyType)

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Application Review</CardTitle>
            <CardDescription>
              Configure how applications are reviewed and accepted
            </CardDescription>
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Disable Review
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Strategy Type */}
        <form.Field name="strategy_type">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="strategy_type">Review Strategy</Label>
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  field.handleChange(value as StrategyType)
                  // Auto-save when strategy type changes
                  setTimeout(() => form.handleSubmit(), 0)
                }}
                disabled={readOnly}
              >
                <SelectTrigger id="strategy_type">
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStrategy && (
                <p className="text-sm text-muted-foreground">
                  {selectedStrategy.description}
                </p>
              )}
            </div>
          )}
        </form.Field>

        {/* Auto Accept Info */}
        {strategyType === "auto_accept" && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              All applications will be automatically accepted when submitted. No
              manual review is required.
            </AlertDescription>
          </Alert>
        )}

        {/* Threshold Settings */}
        {strategyType === "threshold" && (
          <form.Field name="required_approvals">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="required_approvals">Required Approvals</Label>
                <Input
                  id="required_approvals"
                  type="number"
                  min={1}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  onBlur={handleFieldBlur}
                  disabled={readOnly}
                />
                <p className="text-sm text-muted-foreground">
                  Number of reviewer approvals needed to accept an application
                </p>
              </div>
            )}
          </form.Field>
        )}

        {/* Weighted Voting Settings */}
        {strategyType === "weighted" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="accept_threshold">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="accept_threshold">Accept Threshold</Label>
                    <Input
                      id="accept_threshold"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                    <p className="text-sm text-muted-foreground">
                      Points needed to accept
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="reject_threshold">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="reject_threshold">Reject Threshold</Label>
                    <Input
                      id="reject_threshold"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                    <p className="text-sm text-muted-foreground">
                      Points to reject (negative)
                    </p>
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="strong_yes_weight">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="strong_yes_weight">Strong Yes Weight</Label>
                    <Input
                      id="strong_yes_weight"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="yes_weight">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="yes_weight">Yes Weight</Label>
                    <Input
                      id="yes_weight"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="no_weight">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="no_weight">No Weight</Label>
                    <Input
                      id="no_weight"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="strong_no_weight">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="strong_no_weight">Strong No Weight</Label>
                    <Input
                      id="strong_no_weight"
                      type="number"
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      onBlur={handleFieldBlur}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>
            </div>
          </>
        )}

        {/* Veto Setting (for non-auto strategies) */}
        {strategyType !== "auto_accept" && (
          <form.Field name="rejection_is_veto">
            {(field) => (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="rejection_is_veto">Rejection is Veto</Label>
                  <p className="text-sm text-muted-foreground">
                    Any rejection instantly rejects the application
                  </p>
                </div>
                <Switch
                  id="rejection_is_veto"
                  checked={field.state.value}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked)
                    setTimeout(() => form.handleSubmit(), 0)
                  }}
                  disabled={readOnly}
                />
              </div>
            )}
          </form.Field>
        )}

        {/* Save indicator */}
        {isSaving && <p className="text-sm text-muted-foreground">Saving...</p>}
      </CardContent>
    </Card>
  )
}
