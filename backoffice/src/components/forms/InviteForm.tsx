import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Calendar, Hash, Mail, Percent, Power, ShieldCheck } from "lucide-react"
import {
  type InviteCreate,
  type InvitePublic,
  InvitesService,
  type InviteUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface InviteFormProps {
  defaultValues?: InvitePublic
  onSuccess: () => void
}

export function InviteForm({ defaultValues, onSuccess }: InviteFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  const toUTCDate = (dateStr: string) => {
    if (!dateStr) return null
    return `${dateStr.slice(0, 10)}T00:00:00.000Z`
  }

  const createMutation = useMutation({
    mutationFn: (data: InviteCreate) =>
      InvitesService.createInvite({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Invite created successfully", {
        label: "View",
        onClick: () =>
          navigate({
            to: "/invites/$inviteId/edit",
            params: { inviteId: data.id },
          }),
      })
      queryClient.invalidateQueries({ queryKey: ["invites"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: InviteUpdate) =>
      InvitesService.updateInvite({
        inviteId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Invite updated successfully")
      queryClient.invalidateQueries({ queryKey: ["invites"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      InvitesService.deleteInvite({ inviteId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Invite deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["invites"] })
      navigate({ to: "/invites" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      token: defaultValues?.token ?? "",
      recipient_email: defaultValues?.recipient_email ?? "",
      discount_percentage:
        defaultValues?.discount_percentage?.toString() ?? "0",
      max_uses: defaultValues?.max_uses?.toString() ?? "",
      expires_at: formatDateForInput(defaultValues?.expires_at),
      auto_approve: defaultValues?.auto_approve ?? true,
      express_checkout: defaultValues?.express_checkout ?? true,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (isEdit) {
        updateMutation.mutate({
          discount_percentage: Number(value.discount_percentage) || 0,
          max_uses: value.max_uses ? Number(value.max_uses) : null,
          expires_at: toUTCDate(value.expires_at),
          auto_approve: value.auto_approve,
          express_checkout: value.express_checkout,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          token: value.token || undefined,
          recipient_email: value.recipient_email || undefined,
          discount_percentage: Number(value.discount_percentage) || 0,
          max_uses: value.max_uses ? Number(value.max_uses) : undefined,
          auto_approve: value.auto_approve,
          express_checkout: value.express_checkout,
        })
      }
    },
  })

  const blocker = useUnsavedChanges(form)
  const isPending = createMutation.isPending || updateMutation.isPending

  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="invite" action="create" />
  }

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
        {/* Hero: Token */}
        <div className="space-y-3">
          <form.Field name="token">
            {(field) => (
              <div>
                <HeroInput
                  placeholder="Invite token (auto-generated if empty)"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly || isEdit}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        </div>

        {/* Invite metadata (edit only) */}
        {isEdit && (
          <div className="flex gap-6 text-sm text-muted-foreground">
            <div>
              <span className="text-xs uppercase tracking-wider">Token</span>
              <p className="font-mono">{defaultValues.token}</p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider">Uses</span>
              <p className="font-mono">
                {defaultValues.current_uses}
                {defaultValues.max_uses != null
                  ? ` / ${defaultValues.max_uses}`
                  : ""}
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Recipient */}
        <InlineSection title="Recipient">
          <form.Field name="recipient_email">
            {(field) => (
              <InlineRow
                icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                label="Recipient Email"
                description="Lock this invite to a specific email. Leave empty for open use."
              >
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly || isEdit}
                  className="max-w-64 text-sm"
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Discount Settings */}
        <InlineSection title="Discount Settings">
          <form.Field name="discount_percentage">
            {(field) => (
              <InlineRow
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="Discount %"
                description="Discount applied when this invite is redeemed"
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
                  id="expires_at"
                  value={field.state.value}
                  onChange={field.handleChange}
                  disabled={readOnly}
                  placeholder="Select date"
                  className="w-auto"
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Behavior */}
        <InlineSection title="Behavior">
          <form.Field name="auto_approve">
            {(field) => (
              <InlineRow
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                label="Auto Approve"
                description="Automatically approve applications submitted via this invite"
              >
                <Switch
                  id="auto_approve"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="express_checkout">
            {(field) => (
              <InlineRow
                icon={<Power className="h-4 w-4 text-muted-foreground" />}
                label="Express Checkout"
                description="Skip the review step and go directly to checkout on approval"
              >
                <Switch
                  id="express_checkout"
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
            onClick={() => navigate({ to: "/invites" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Invite"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this invite, it cannot be undone. Invites with existing redemptions cannot be deleted."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Invite"
            resourceName={defaultValues.token}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
