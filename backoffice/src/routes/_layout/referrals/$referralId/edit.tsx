import { useForm } from "@tanstack/react-form"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Ban, Calendar, Hash, Percent } from "lucide-react"
import { Suspense } from "react"
import { InvitesService, type InviteUpdate } from "@/client"
import { SourceApplicationsSection } from "@/components/applications/SourceApplicationsSection"
import { DangerZone } from "@/components/Common/DangerZone"
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
    queryFn: () => InvitesService.getInvite({ inviteId: referralId }),
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
    mutationFn: (data: InviteUpdate) =>
      InvitesService.updateInvite({
        inviteId: referral.id,
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

  const deleteMutation = useMutation({
    mutationFn: () => InvitesService.deleteInvite({ inviteId: referral.id }),
    onSuccess: () => {
      showSuccessToast("Referral deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["referrals"] })
      navigate({ to: "/referrals" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      discount_percentage: referral.discount_percentage?.toString() ?? "0",
      max_uses: referral.max_uses?.toString() ?? "",
      expires_at: formatDateForInput(referral.expires_at),
      is_disabled: referral.is_disabled ?? false,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      updateMutation.mutate({
        discount_percentage: Number(value.discount_percentage) || 0,
        max_uses: value.max_uses ? Number(value.max_uses) : null,
        expires_at: toUTCDate(value.expires_at),
        is_disabled: value.is_disabled,
      })
    },
  })

  const blocker = useUnsavedChanges(form)
  const isPending = updateMutation.isPending || deleteMutation.isPending

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
            <p className="font-mono">{referral.token}</p>
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

          <form.Field name="is_disabled">
            {(field) => (
              <InlineRow
                icon={<Ban className="h-4 w-4 text-muted-foreground" />}
                label="Disabled"
                description="Prevent new applications without affecting people who already used this referral"
              >
                <Switch
                  id="referral_is_disabled"
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
      <SourceApplicationsSection
        popupId={referral.popup_id}
        source="referral"
        sourceId={referral.id}
      />
      {!readOnly && referral.current_uses === 0 && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Delete this unused referral permanently."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Referral"
            resourceName={referral.token}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function EditReferralPage() {
  const { referralId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Referral"
      description="Update discount and availability settings for this referral code"
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
