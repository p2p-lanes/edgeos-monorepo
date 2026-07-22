import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  ExternalLink,
  GraduationCap,
  MapPin,
  MessageCircle,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import {
  type ApiError,
  type ApplicationPublic,
  ApplicationReviewsService,
  ApplicationsService,
  ApprovalStrategiesService,
  FormFieldsService,
  type PopupAdmin,
  PopupsService,
  type ReviewDecision,
  type ScholarshipDecisionRequest,
} from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

// ========================
// Types
// ========================

interface FormFieldSchema {
  type: string
  label: string
  required: boolean
  section?: string
  section_id?: string | null
  position?: number
  options?: string[]
  placeholder?: string
  help_text?: string
}

interface FormSectionSchema {
  id: string
  label: string
  description: string | null
  order: number
}

interface ApplicationSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: FormSectionSchema[]
}

// ========================
// Voting Components
// ========================

function WeightedVoting({
  application,
  onSuccess,
}: {
  application: ApplicationPublic
  onSuccess: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [selectedDecision, setSelectedDecision] =
    useState<ReviewDecision | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      ApplicationReviewsService.submitReview({
        applicationId: application.id,
        requestBody: { decision },
      }),
    onSuccess: (_, decision) => {
      showSuccessToast(`Review submitted: ${decision.replace("_", " ")}`)
      setDialogOpen(false)
      setSelectedDecision(null)
      onSuccess()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const handleVote = (decision: ReviewDecision) => {
    setSelectedDecision(decision)
    setDialogOpen(true)
  }

  const labels: Record<ReviewDecision, string> = {
    strong_yes: "Strong Yes",
    yes: "Yes",
    no: "No",
    strong_no: "Strong No",
  }

  return (
    <>
      <div className="space-y-2">
        <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Cast Your Vote
        </p>
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            className="w-full justify-start bg-green-700 hover:bg-green-800 text-white"
            onClick={() => handleVote("strong_yes")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
            <ChevronUp className="-ml-2 h-3.5 w-3.5" />
            Strong Yes
          </Button>
          <Button
            size="sm"
            className="w-full justify-start bg-green-500 hover:bg-green-600 text-white"
            onClick={() => handleVote("yes")}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            Yes
          </Button>
          <Button
            size="sm"
            className="w-full justify-start bg-red-400 hover:bg-red-500 text-white"
            onClick={() => handleVote("no")}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            No
          </Button>
          <Button
            size="sm"
            className="w-full justify-start bg-red-700 hover:bg-red-800 text-white"
            onClick={() => handleVote("strong_no")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <ChevronDown className="-ml-2 h-3.5 w-3.5" />
            Strong No
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Confirm Vote: {selectedDecision && labels[selectedDecision]}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to vote "
              {selectedDecision && labels[selectedDecision]}" for the
              application from "{application.human?.first_name}{" "}
              {application.human?.last_name}"? This will submit your review and
              may update the application status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant={
                selectedDecision === "no" || selectedDecision === "strong_no"
                  ? "destructive"
                  : "default"
              }
              loading={mutation.isPending}
              onClick={() =>
                selectedDecision && mutation.mutate(selectedDecision)
              }
            >
              Submit Vote
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SimpleVoting({
  application,
  onSuccess,
}: {
  application: ApplicationPublic
  onSuccess: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(
    null,
  )
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      ApplicationReviewsService.submitReview({
        applicationId: application.id,
        requestBody: { decision },
      }),
    onSuccess: (_, decision) => {
      const action = decision === "yes" ? "Approved" : "Rejected"
      showSuccessToast(
        `${action}: ${application.human?.first_name} ${application.human?.last_name}`,
      )
      setDialogOpen(false)
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleClick = (decision: ReviewDecision) => {
    setPendingDecision(decision)
    setDialogOpen(true)
  }

  return (
    <>
      <div className="space-y-2">
        <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Review
        </p>
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            className="w-full justify-start bg-green-600 hover:bg-green-700 text-white border-0"
            onClick={() => handleClick("yes")}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            className="w-full justify-start bg-red-600 hover:bg-red-700 text-white border-0"
            onClick={() => handleClick("no")}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDecision === "yes" ? "Approve" : "Reject"} Application
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to{" "}
              {pendingDecision === "yes" ? "approve" : "reject"} the application
              from "{application.human?.first_name}{" "}
              {application.human?.last_name}"?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant={pendingDecision === "no" ? "destructive" : "default"}
              loading={mutation.isPending}
              onClick={() =>
                pendingDecision && mutation.mutate(pendingDecision)
              }
            >
              {pendingDecision === "yes" ? "Approve" : "Reject"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewSummary({
  summary,
}: {
  summary: {
    total_reviews: number
    reviews: Array<{
      id: string
      reviewer_full_name?: string | null
      reviewer_email?: string | null
      decision: string
      notes?: string | null
    }>
  }
}) {
  return (
    <InlineSection title={`Reviews (${summary.total_reviews})`}>
      {summary.reviews.map((review) => (
        <div key={review.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">
              {review.reviewer_full_name || review.reviewer_email || "Unknown"}
            </p>
            {review.notes && (
              <p className="text-xs text-muted-foreground">{review.notes}</p>
            )}
          </div>
          <StatusBadge status={review.decision} />
        </div>
      ))}
    </InlineSection>
  )
}

// ========================
// Scholarship Panel
// ========================

function ScholarshipPanel({
  application,
  popup,
  onSuccess,
}: {
  application: ApplicationPublic
  popup: PopupAdmin
  onSuccess: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [discountPct, setDiscountPct] = useState("")
  const [incentiveAmount, setIncentiveAmount] = useState("")
  const [incentiveCurrency, setIncentiveCurrency] = useState("USD")

  const scholarshipStatus = application.scholarship_status ?? null
  const isPending =
    scholarshipStatus === null || scholarshipStatus === "pending"
  const isApproved = scholarshipStatus === "approved"
  const showForm = isPending || isEditing

  const mutation = useMutation({
    mutationFn: (payload: ScholarshipDecisionRequest) =>
      ApplicationsService.reviewScholarship({
        applicationId: application.id,
        requestBody: payload,
      }),
    onSuccess: () => {
      showSuccessToast("Scholarship decision saved")
      setRejectDialogOpen(false)
      setIsEditing(false)
      queryClient.invalidateQueries({
        queryKey: ["applications", application.id],
      })
      onSuccess()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const sanitizeNumericInput = (value: string, max?: number): string => {
    // Strip non-numeric chars except decimal point
    const cleaned = value.replace(/[^0-9.]/g, "")
    // Prevent multiple decimal points
    const parts = cleaned.split(".")
    const sanitized =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned
    // Enforce max value
    if (max !== undefined && sanitized !== "" && Number(sanitized) > max) {
      return String(max)
    }
    return sanitized
  }

  const handleApprove = () => {
    const discount = Number(discountPct)
    if (Number.isNaN(discount) || discount < 0 || discount > 100) {
      showErrorToast("Discount percentage must be between 0 and 100")
      return
    }
    const payload: ScholarshipDecisionRequest = {
      scholarship_status: "approved",
      discount_percentage: discount,
    }
    if (popup.allows_incentive && incentiveAmount) {
      const amount = Number(incentiveAmount)
      if (Number.isNaN(amount) || amount < 0) {
        showErrorToast("Incentive amount must be a positive number")
        return
      }
      payload.incentive_amount = amount
      payload.incentive_currency = incentiveCurrency || "USD"
    }
    mutation.mutate(payload)
  }

  const handleReject = () => {
    mutation.mutate({ scholarship_status: "rejected" })
  }

  const handleEnterEdit = () => {
    setDiscountPct(
      application.discount_percentage != null
        ? String(application.discount_percentage)
        : "",
    )
    setIncentiveAmount(
      application.incentive_amount != null
        ? String(application.incentive_amount)
        : "",
    )
    setIncentiveCurrency(application.incentive_currency || "USD")
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setDiscountPct("")
    setIncentiveAmount("")
    setIncentiveCurrency("USD")
  }

  const discountValue = application.discount_percentage
    ? Number(application.discount_percentage)
    : null
  const incentiveValue = application.incentive_amount
    ? Number(application.incentive_amount)
    : null

  return (
    <>
      <Separator />
      <InlineSection title="Scholarship">
        {/* Status */}
        <InlineRow
          icon={<GraduationCap className="h-4 w-4 text-muted-foreground" />}
          label="Scholarship Status"
        >
          <StatusBadge status={scholarshipStatus ?? "none"} />
        </InlineRow>

        {/* Approved details */}
        {isApproved && !isEditing && discountValue !== null && (
          <InlineRow label="Discount">
            <span className="font-mono text-sm font-medium">
              {discountValue}%
            </span>
          </InlineRow>
        )}
        {isApproved &&
          !isEditing &&
          popup.allows_incentive &&
          incentiveValue !== null &&
          incentiveValue > 0 && (
            <InlineRow label="Incentive">
              <span className="font-mono text-sm font-medium">
                {incentiveValue} {application.incentive_currency}
              </span>
            </InlineRow>
          )}
        {isApproved && !isEditing && (
          <div className="py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleEnterEdit}
              disabled={mutation.isPending}
            >
              Edit Discount
            </Button>
          </div>
        )}

        {/* Details text */}
        {application.scholarship_details && (
          <div className="py-3">
            <p className="text-xs text-muted-foreground mb-1">
              Scholarship Details
            </p>
            <p className="text-sm whitespace-pre-wrap">
              {application.scholarship_details}
            </p>
          </div>
        )}

        {/* Video URL */}
        {application.scholarship_video_url && (
          <InlineRow label="Video">
            <a
              href={application.scholarship_video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Watch
              <ExternalLink className="h-3 w-3" />
            </a>
          </InlineRow>
        )}

        {/* Admin controls — when pending or editing an approved scholarship */}
        {showForm && (
          <div className="space-y-4 py-3">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {isEditing ? "Edit Scholarship" : "Approve Scholarship"}
              </p>
              <div className="space-y-2">
                <Label htmlFor="discount_pct" className="text-sm">
                  Discount Percentage (0–100)
                </Label>
                <Input
                  id="discount_pct"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 100"
                  value={discountPct}
                  onChange={(e) =>
                    setDiscountPct(sanitizeNumericInput(e.target.value, 100))
                  }
                  className="max-w-[160px]"
                />
              </div>

              {popup.allows_incentive && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="incentive_amount" className="text-sm">
                      Incentive Amount (optional)
                    </Label>
                    <Input
                      id="incentive_amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 1000"
                      value={incentiveAmount}
                      onChange={(e) =>
                        setIncentiveAmount(sanitizeNumericInput(e.target.value))
                      }
                      className="max-w-[160px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="incentive_currency" className="text-sm">
                      Currency
                    </Label>
                    <Input
                      id="incentive_currency"
                      type="text"
                      placeholder="USD"
                      value={incentiveCurrency}
                      onChange={(e) => setIncentiveCurrency(e.target.value)}
                      className="max-w-[100px] uppercase"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <LoadingButton
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white border-0"
                  loading={mutation.isPending}
                  onClick={handleApprove}
                >
                  {isEditing ? "Save Changes" : "Approve Scholarship"}
                </LoadingButton>
                {isEditing ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                    disabled={mutation.isPending}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={mutation.isPending}
                  >
                    Reject Scholarship
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </InlineSection>

      {/* Reject confirmation dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Scholarship</DialogTitle>
            <DialogDescription>
              Are you sure you want to reject the scholarship request from "
              {application.human?.first_name} {application.human?.last_name}"?
              This action will mark the scholarship as rejected and re-evaluate
              the application status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={mutation.isPending}
              onClick={handleReject}
            >
              Reject Scholarship
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ========================
// Grant Credit Panel
// ========================

function GrantCreditPanel({
  application,
  onSuccess,
}: {
  application: ApplicationPublic
  onSuccess: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      ApplicationsService.grantApplicationCredit({
        applicationId: application.id,
        requestBody: { amount: Number(amount), note: note || undefined },
      }),
    onSuccess: (data) => {
      showSuccessToast(
        `Credit granted. New balance: $${Number(data.credit).toFixed(2)}`,
      )
      setAmount("")
      setNote("")
      queryClient.invalidateQueries({
        queryKey: ["applications", application.id],
      })
      onSuccess()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const handleSubmit = () => {
    const parsed = Number(amount)
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      showErrorToast("Amount must be greater than zero")
      return
    }
    mutation.mutate()
  }

  // The current balance is already shown as "Account Credit" in the applicant
  // details above; don't repeat it here.
  return (
    <>
      <Separator />
      <InlineSection title="Grant Credit">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="grant-credit-amount">Amount</Label>
            <Input
              id="grant-credit-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grant-credit-note">Note (optional)</Label>
            <Input
              id="grant-credit-note"
              type="text"
              placeholder="Reason for grant"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <LoadingButton
            loading={mutation.isPending}
            onClick={handleSubmit}
            className="w-full"
          >
            Grant Credit
          </LoadingButton>
        </div>
      </InlineSection>
    </>
  )
}

// ========================
// Main Component
// ========================

interface ApplicationDetailProps {
  application: ApplicationPublic
  onReviewSuccess: () => void
  headerExtra?: ReactNode
}

export function ApplicationDetail({
  application,
  onReviewSuccess,
  headerExtra,
}: ApplicationDetailProps) {
  const { isAdmin, isOperatorOrAbove } = useAuth()

  const { data: schema } = useQuery({
    queryKey: ["form-fields-schema", application.popup_id],
    queryFn: async () => {
      const result = await FormFieldsService.getApplicationSchema({
        popupId: application.popup_id,
      })
      return result as unknown as ApplicationSchema
    },
  })

  const { data: reviewSummary, refetch: refetchReviews } = useQuery({
    queryKey: ["review-summary", application.id],
    queryFn: () =>
      ApplicationReviewsService.getReviewSummary({
        applicationId: application.id,
      }),
    enabled: application.status !== "draft",
  })

  const { data: approvalStrategy } = useQuery({
    queryKey: ["approval-strategy", application.popup_id],
    queryFn: () =>
      ApprovalStrategiesService.getApprovalStrategy({
        popupId: application.popup_id,
      }),
    retry: false,
  })

  const { data: popup } = useQuery({
    queryKey: ["popups", application.popup_id],
    queryFn: () => PopupsService.getPopup({ popupId: application.popup_id }),
  })

  const isWeightedVoting = approvalStrategy?.strategy_type === "weighted"
  const canReview = isOperatorOrAbove && application.status === "in review"
  const companions =
    application.attendees?.filter((a) => a.category !== "main") ?? []

  const handleReviewSuccess = () => {
    refetchReviews()
    onReviewSuccess()
  }

  const getFieldLabel = (fieldName: string): string => {
    if (schema?.custom_fields?.[fieldName]?.label) {
      return schema.custom_fields[fieldName].label
    }
    return fieldName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  const formatFieldValue = (fieldName: string, value: unknown): string => {
    if (value === null || value === undefined) return "—"
    const fieldDef = schema?.custom_fields?.[fieldName]
    const fieldType = fieldDef?.type
    if (fieldType === "boolean") return value ? "Yes" : "No"
    if (fieldType === "multiselect" && Array.isArray(value))
      return value.join(", ")
    if (fieldType === "date" && typeof value === "string") {
      return new Date(value).toLocaleDateString()
    }
    return String(value)
  }

  const getCustomFieldsBySection = () => {
    if (
      !application.custom_fields ||
      Object.keys(application.custom_fields).length === 0
    ) {
      return {
        unsectioned: [] as [string, unknown][],
        sectioned: {} as Record<
          string,
          { label: string; fields: [string, unknown][] }
        >,
      }
    }
    const entries = Object.entries(application.custom_fields)
    const sorted = schema?.custom_fields
      ? entries.sort(([a], [b]) => {
          const posA = schema.custom_fields[a]?.position ?? 0
          const posB = schema.custom_fields[b]?.position ?? 0
          return posA - posB
        })
      : entries
    const unsectioned: [string, unknown][] = []
    const sectioned: Record<
      string,
      { label: string; fields: [string, unknown][] }
    > = {}
    const detailSectionMap = new Map(
      (schema?.sections ?? []).map((s) => [s.id, s]),
    )
    for (const [key, value] of sorted) {
      const sectionId = schema?.custom_fields?.[key]?.section_id
      if (sectionId) {
        if (!sectioned[sectionId]) {
          const info = detailSectionMap.get(sectionId)
          sectioned[sectionId] = { label: info?.label ?? "Other", fields: [] }
        }
        sectioned[sectionId].fields.push([key, value])
      } else {
        unsectioned.push([key, value])
      }
    }
    return { unsectioned, sectioned }
  }

  const {
    unsectioned: unsectionedCustomFields,
    sectioned: sectionedCustomFields,
  } = getCustomFieldsBySection()

  const renderCustomField = (key: string, value: unknown) => {
    const fieldDef = schema?.custom_fields?.[key]
    if (fieldDef?.type === "signature") {
      const sig = (value ?? {}) as { signature?: string; signed_at?: string }
      return (
        <div key={key} className="sm:col-span-2">
          {sig.signature ? (
            <div className="space-y-1">
              <img
                src={sig.signature}
                alt="Signature"
                className="h-16 rounded-md border bg-white object-contain"
              />
              {sig.signed_at && (
                <p className="text-xs text-muted-foreground">
                  Signed on {new Date(sig.signed_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>
      )
    }
    const formatted = formatFieldValue(key, value)
    const hasUnbreakableWord = formatted
      .split(/\s+/)
      .some((word) => word.length > 24)
    const fullRow = hasUnbreakableWord
    return (
      <div key={key} className={cn("min-w-0", fullRow && "sm:col-span-2")}>
        <p className="text-xs text-muted-foreground break-words">
          {getFieldLabel(key)}
        </p>
        <p className="text-sm break-words">{formatted}</p>
      </div>
    )
  }

  const votingPanel = isWeightedVoting ? (
    <WeightedVoting application={application} onSuccess={handleReviewSuccess} />
  ) : (
    <SimpleVoting application={application} onSuccess={handleReviewSuccess} />
  )

  const hasReviews =
    application.status !== "draft" &&
    reviewSummary &&
    reviewSummary.total_reviews > 0

  return (
    <div className="relative mx-auto w-[32rem] max-w-full space-y-6">
      {/* Hero */}
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <Link
            to="/humans/$id"
            params={{ id: application.human_id }}
            className="group inline-flex items-start gap-2"
            title="View human profile"
          >
            <h2 className="text-3xl font-semibold group-hover:underline">
              {application.human?.first_name} {application.human?.last_name}
            </h2>
            <ExternalLink className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {application.red_flag && (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Flagged
              </Badge>
            )}
            <StatusBadge status={application.status} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {application.human?.email}
        </p>
      </div>

      {headerExtra}

      {/* Mobile action panel */}
      {canReview && (
        <div className="space-y-4 lg:hidden">
          {votingPanel}
          {hasReviews && <ReviewSummary summary={reviewSummary} />}
          <Separator />
        </div>
      )}

      <Separator />

      {/* Review summary (when not reviewer but reviews exist) */}
      {!canReview && hasReviews && (
        <>
          <ReviewSummary summary={reviewSummary} />
          <Separator />
        </>
      )}

      {/* Applicant */}
      <InlineSection title="Applicant">
        {application.human?.residence && (
          <InlineRow
            icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
            label="Residence"
          >
            <span className="text-sm">{application.human.residence}</span>
          </InlineRow>
        )}
        {application.human?.telegram && (
          <InlineRow
            icon={<MessageCircle className="h-4 w-4 text-muted-foreground" />}
            label="Telegram"
          >
            <span className="text-sm">{application.human.telegram}</span>
          </InlineRow>
        )}
        {application.human?.gender && (
          <InlineRow label="Gender">
            <span className="text-sm capitalize">
              {application.human.gender}
            </span>
          </InlineRow>
        )}
        {application.human?.age && (
          <InlineRow label="Age Range">
            <span className="text-sm">{application.human.age}</span>
          </InlineRow>
        )}
        {application.referral && (
          <InlineRow label="Referral">
            <span className="text-sm">{application.referral}</span>
          </InlineRow>
        )}
        {(() => {
          const credit = Number(application.credit)
          return credit > 0 ? (
            <InlineRow
              icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
              label="Account Credit"
            >
              <span className="font-mono text-sm">${credit.toFixed(2)}</span>
            </InlineRow>
          ) : null
        })()}
      </InlineSection>

      {/* Unsectioned custom fields */}
      {unsectionedCustomFields.length > 0 && (
        <>
          <Separator />
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {unsectionedCustomFields.map(([key, value]) =>
              renderCustomField(key, value),
            )}
          </div>
        </>
      )}

      {/* Sectioned custom fields */}
      {Object.entries(sectionedCustomFields).map(
        ([sectionId, { label: sectionLabel, fields }]) => (
          <div key={sectionId}>
            <Separator />
            <InlineSection title={sectionLabel} className="capitalize pt-4">
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 py-3">
                {fields.map(([key, value]) => renderCustomField(key, value))}
              </div>
            </InlineSection>
          </div>
        ),
      )}

      {/* Companions */}
      {companions.length > 0 && (
        <>
          <Separator />
          <InlineSection title={`Companions (${companions.length})`}>
            {companions.map((attendee) => (
              <div key={attendee.id} className="py-3">
                <p className="text-sm font-medium">{attendee.name}</p>
                <p className="text-xs text-muted-foreground">
                  {attendee.email} ·{" "}
                  <span className="capitalize">{attendee.category}</span>
                </p>
              </div>
            ))}
          </InlineSection>
        </>
      )}

      {/* Scholarship Panel */}
      {application.scholarship_request && popup?.allows_scholarship && (
        <ScholarshipPanel
          application={application}
          popup={popup}
          onSuccess={onReviewSuccess}
        />
      )}

      {/* Grant Credit Panel — admin only, and only once accepted */}
      {isAdmin && application.status === "accepted" && (
        <GrantCreditPanel
          application={application}
          onSuccess={onReviewSuccess}
        />
      )}

      {/* Desktop action panel */}
      {canReview && (
        <aside className="absolute top-0 left-[calc(100%+2rem)] hidden w-56 lg:block">
          <div className="sticky top-24 space-y-6">
            {votingPanel}
            {hasReviews && <ReviewSummary summary={reviewSummary} />}
          </div>
        </aside>
      )}
    </div>
  )
}
