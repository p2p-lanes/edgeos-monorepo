import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  type CouponCreate,
  type CouponPublic,
  CouponsService,
  type CouponUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface CouponFormProps {
  defaultValues?: CouponPublic
  onSuccess: () => void
}

export function CouponForm({ defaultValues, onSuccess }: CouponFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const createMutation = useMutation({
    mutationFn: (data: CouponCreate) =>
      CouponsService.createCoupon({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Coupon created successfully")
      queryClient.invalidateQueries({ queryKey: ["coupons"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
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
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      CouponsService.deleteCoupon({ couponId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Coupon deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["coupons"] })
      navigate({ to: "/coupons" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      code: defaultValues?.code ?? "",
      discount_value: defaultValues?.discount_value?.toString() ?? "10",
      max_uses: defaultValues?.max_uses?.toString() ?? "",
      is_active: defaultValues?.is_active ?? true,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (isEdit) {
        updateMutation.mutate({
          code: value.code.toUpperCase(),
          discount_value: Number(value.discount_value),
          max_uses: value.max_uses ? Number(value.max_uses) : null,
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
          is_active: value.is_active,
        })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Show alert if no popup selected (only for create mode)
  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="coupon" action="create" />
  }

  return (
    <div className="space-y-6">
      {isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Coupon Information</CardTitle>
            <CardDescription>Details about this coupon</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Current Uses</Label>
              <p className="font-mono text-sm">
                {defaultValues.current_uses ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            {readOnly
              ? "Coupon Details"
              : isEdit
                ? "Edit Coupon"
                : "Coupon Details"}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? "View coupon information (read-only)"
              : isEdit
                ? "Update the coupon settings"
                : "Enter the information for the new discount coupon"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!readOnly) {
                form.handleSubmit()
              }
            }}
            className="space-y-6"
          >
            <form.Field
              name="code"
              validators={{
                onBlur: ({ value }) =>
                  !readOnly && !value ? "Code is required" : undefined,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="code">
                    Code{" "}
                    {!readOnly && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="code"
                    placeholder="SUMMER2025"
                    className="uppercase"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                  />
                  <p className="text-sm text-muted-foreground">
                    The code users will enter (will be uppercased)
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="grid gap-6 md:grid-cols-2">
              <form.Field
                name="discount_value"
                validators={{
                  onBlur: ({ value }) =>
                    !readOnly && !value ? "Discount is required" : undefined,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="discount_value">
                      Discount %{" "}
                      {!readOnly && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      id="discount_value"
                      type="number"
                      min={1}
                      max={100}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="max_uses">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="max_uses">Max Uses</Label>
                    <Input
                      id="max_uses"
                      type="number"
                      min={1}
                      placeholder="Unlimited"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                    />
                    <p className="text-sm text-muted-foreground">
                      Leave empty for unlimited
                    </p>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="is_active">
              {(field) => (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="is_active">Active</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable this coupon for use
                    </p>
                  </div>
                  <Switch
                    id="is_active"
                    checked={field.state.value}
                    onCheckedChange={(val) => field.handleChange(val)}
                    disabled={readOnly}
                  />
                </div>
              )}
            </form.Field>

            <div className="flex gap-4 pt-4">
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
        </CardContent>
      </Card>

      {isEdit && !readOnly && (
        <DangerZone
          description="Once you delete this coupon, it will be permanently removed. Existing discounts already applied will not be affected."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Coupon"
          resourceName={defaultValues.code}
        />
      )}
    </div>
  )
}
