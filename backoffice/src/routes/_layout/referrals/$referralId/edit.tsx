import { useForm } from "@tanstack/react-form"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Calendar, Hash, Percent, ShieldCheck } from "lucide-react"
import { Suspense } from "react"
import { type ReferralAdminUpdate, ReferralsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/referrals/$referralId/edit")({
  component: EditReferralPage,
  head: () => ({
    meta: [{ title: "Edit Referral - EdgeOS" }],
  }),
})

function getReferralQueryOptions(referralId: string) {
  return {
    queryKey: ["referrals", referralId],
    queryFn: () => ReferralsService.getReferralAdmin({ referralId }),
  }
}

function EditReferralContent({ referralId }: { referralId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const goBack = useGoBack({ to: "/referrals" })
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isOperatorOrAbove } = useAuth()
  const readOnly = !isOperatorOrAbove

  const { data: referral } = useSuspenseQuery(
    getReferralQueryOptions(referralId),
  )

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  const toUTCDate = (dateStr: string) => {
    if (!dateStr) return null
    return `${dateStr.slice(0, 10)}T00:00:00.000Z`
  }

  const updateMutation = useMutation({
    mutationFn: (data: ReferralAdminUpdate) =>
      ReferralsService.updateReferralAdmin({
        referralId: referral.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Referral updated successfully")
      queryClient.invalidateQueries({ queryKey: ["referrals"] })
      form.reset()
      goBack()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      discount_percentage: referral.discount_percentage?.toString() ?? "0",
      max_uses: referral.max_uses?.toString() ?? "",
      expires_at: formatDateForInput(referral.expires_at),
      auto_approve: referral.auto_approve ?? false,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      updateMutation.mutate({
        discount_percentage: Number(value.discount_percentage) || 0,
        max_uses: value.max_uses ? Number(value.max_uses) : null,
        expires_at: toUTCDate(value.expires_at),
        auto_approve: value.auto_approve,
      })
    },
  })

  const blocker = useUnsavedChanges(form)
  const isPending = updateMutation.isPending

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly) {
            form.handleSubmit()
          }
        }}
        className="mx-auto max-w-2xl space-y-6"
      >
        {/* Referral metadata */}
        <div className="flex gap-6 text-sm text-muted-foreground">
          <div>
            <span className="text-xs uppercase tracking-wider">Code</span>
            <p className="font-mono">{referral.code}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider">Uses</span>
            <p className="font-mono">
              {referral.current_uses}
              {referral.max_uses != null ? ` / ${referral.max_uses}` : ""}
            </p>
          </div>
        </div>

        <Separator />

        {/* Admin Settings */}
        <InlineSection title="Admin Settings">
          <form.Field name="discount_percentage">
            {(field) => (
              <InlineRow
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="Discount %"
                description="Discount applied when this referral code is used"
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                  className="max-w-24 text-sm"
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="max_uses">
            {(field) => (
              <InlineRow
                icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                label="Max Uses"
                description="Leave empty for unlimited redemptions"
              >
                <Input
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                  className="max-w-32 text-sm"
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="expires_at">
            {(field) => (
              <InlineRow
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                label="Expiry Date"
                description="Leave empty for no expiration"
              >
                <DatePicker
                  id="referral_expires_at"
                  value={field.state.value}
                  onChange={field.handleChange}
                  disabled={readOnly}
                  placeholder="Select date"
                  className="w-auto"
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="auto_approve">
            {(field) => (
              <InlineRow
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                label="Auto Approve"
                description="Automatically approve applications submitted via this referral"
              >
                <Switch
                  id="referral_auto_approve"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Form Actions */}
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/referrals" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              Save Changes
            </LoadingButton>
          )}
        </div>
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function EditReferralPage() {
  const { referralId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Referral"
      description="Update discount and approval settings for this referral code"
      backTo="/referrals"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditReferralContent referralId={referralId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
