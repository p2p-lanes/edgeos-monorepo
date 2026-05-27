import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Calendar, Hash, Percent, Power } from "lucide-react"
import {
  type CouponCreate,
  type CouponPublic,
  CouponsService,
  type CouponUpdate,
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

interface CouponFormProps {
  defaultValues?: CouponPublic
  onSuccess: () => void
}

export function CouponForm({ defaultValues, onSuccess }: CouponFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove

  const createMutation = useMutation({
    mutationFn: (data: CouponCreate) =>
      CouponsService.createCoupon({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Coupon created successfully", {
        label: "View",
        onClick: () =>
          navigate({ to: "/coupons/$id/edit", params: { id: data.id } }),
      })
      queryClient.invalidateQueries({ queryKey: ["coupons"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: CouponUpdate) =>
      CouponsService.updateCoupon({
        couponId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Coupon updated successfully")
      queryClient.invalidateQueries({ queryKey: ["coupons"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      CouponsService.deleteCoupon({ couponId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Coupon deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["coupons"] })
      navigate({ to: "/coupons" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  const toUTCDate = (dateStr: string) => {
    if (!dateStr) return null
    return `${dateStr.slice(0, 10)}T00:00:00.000Z`
  }

  const form = useForm({
    defaultValues: {
      code: defaultValues?.code ?? "",
      discount_value: defaultValues?.discount_value?.toString() ?? "10",
      max_uses: defaultValues?.max_uses?.toString() ?? "",
      start_date: formatDateForInput(defaultValues?.start_date),
      end_date: formatDateForInput(defaultValues?.end_date),
      is_active: defaultValues?.is_active ?? true,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (isEdit) {
        updateMutation.mutate({
          code: value.code.toUpperCase(),
          discount_value: Number(value.discount_value),
          max_uses: value.max_uses ? Number(value.max_uses) : null,
          start_date: toUTCDate(value.start_date),
          end_date: toUTCDate(value.end_date),
          is_active: value.is_active,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        if (!value.code || !value.discount_value) {
          showErrorToast("Please fill in all required fields")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          code: value.code.toUpperCase(),
          discount_value: Number(value.discount_value),
          max_uses: value.max_uses ? Number(value.max_uses) : undefined,
          start_date: toUTCDate(value.start_date),
          end_date: toUTCDate(value.end_date),
          is_active: value.is_active,
        })
      }
    },
  })

  const blocker = useUnsavedChanges(form)

  const isPending = createMutation.isPending || updateMutation.isPending

  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="coupon" action="create" />
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
        {/* Hero: Code */}
        <div className="space-y-3">
          <form.Field
            name="code"
            validators={{
              onBlur: ({ value }) =>
                !readOnly && !value ? "Code is required" : undefined,
            }}
          >
            {(field) => (
              <div>
                <HeroInput
                  placeholder="COUPON CODE"
                  className="uppercase"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        </div>

        {/* Coupon metadata (edit only) */}
        {isEdit && (
          <div className="flex gap-6 text-sm text-muted-foreground">
            {defaultValues.current_uses != null && (
              <div>
                <span className="text-xs uppercase tracking-wider">
                  Current Uses
                </span>
                <p className="font-mono">{defaultValues.current_uses}</p>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Discount Settings */}
        <InlineSection title="Discount Settings">
          <form.Field
            name="discount_value"
            validators={{
              onBlur: ({ value }) => {
                if (!readOnly && !value) return "Discount is required"
                const num = Number(value)
                if (num < 1 || num > 100)
                  return "Discount must be between 1 and 100"
                return undefined
              },
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                  label="Discount %"
                >
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                    className="max-w-24 text-sm"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="max_uses">
            {(field) => (
              <InlineRow
                icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                label="Max Uses"
                description="Leave empty for unlimited"
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

          <form.Field name="is_active">
            {(field) => (
              <InlineRow
                icon={<Power className="h-4 w-4 text-muted-foreground" />}
                label="Active"
                description="Enable this coupon for use"
              >
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(val) => field.handleChange(val)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Validity Period */}
        <InlineSection title="Validity Period">
          <form.Field name="start_date">
            {(field) => (
              <div>
                <InlineRow
                  icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                  label="Start Date"
                  description="Leave empty to allow immediate use"
                >
                  <DatePicker
                    id="start_date"
                    value={field.state.value}
                    onChange={field.handleChange}
                    disabled={readOnly}
                    placeholder="Select date"
                    className="w-auto"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.start_date}>
            {(startDate) => {
              const startDateAsDate = startDate
                ? (() => {
                    const [y, m, d] = startDate
                      .slice(0, 10)
                      .split("-")
                      .map(Number)
                    return new Date(y, m - 1, d)
                  })()
                : undefined
              return (
                <form.Field
                  name="end_date"
                  validators={{
                    onChange: ({ value, fieldApi }) => {
                      if (readOnly || !value) return undefined
                      const startDateValue =
                        fieldApi.form.getFieldValue("start_date")
                      if (!startDateValue) return undefined
                      const sd = new Date(startDateValue)
                      const endDate = new Date(value)
                      if (endDate < sd) {
                        return "End date cannot be before start date"
                      }
                      return undefined
                    },
                  }}
                >
                  {(field) => (
                    <div>
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="End Date"
                        description="Leave empty for no expiration"
                      >
                        <DatePicker
                          id="end_date"
                          value={field.state.value}
                          onChange={field.handleChange}
                          disabled={readOnly}
                          placeholder="Select date"
                          defaultMonth={startDateAsDate}
                          className="w-auto"
                        />
                      </InlineRow>
                      <FieldError errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
              )
            }}
          </form.Subscribe>
        </InlineSection>

        <Separator />

        {/* Form Actions */}
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/coupons" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Coupon"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this coupon, it will be permanently removed. Existing discounts already applied will not be affected."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Coupon"
            resourceName={defaultValues.code}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
