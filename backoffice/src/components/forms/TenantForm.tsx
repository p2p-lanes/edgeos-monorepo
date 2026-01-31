import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  type TenantCreate,
  type TenantPublic,
  TenantsService,
  type TenantUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface TenantFormProps {
  defaultValues?: TenantPublic
  onSuccess: () => void
}

export function TenantForm({ defaultValues, onSuccess }: TenantFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: TenantCreate) =>
      TenantsService.createTenant({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Tenant created successfully")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: TenantUpdate) =>
      TenantsService.updateTenant({
        tenantId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Tenant updated successfully")
      queryClient.invalidateQueries({
        queryKey: ["tenants", defaultValues!.id],
      })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      TenantsService.deleteTenant({ tenantId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Tenant deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
      navigate({ to: "/tenants" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      sender_email: defaultValues?.sender_email ?? "",
      sender_name: defaultValues?.sender_name ?? "",
      image_url: defaultValues?.image_url ?? "",
      icon_url: defaultValues?.icon_url ?? "",
    },
    onSubmit: ({ value }) => {
      if (isEdit) {
        updateMutation.mutate({
          sender_email: value.sender_email || null,
          sender_name: value.sender_name || null,
          image_url: value.image_url || null,
          icon_url: value.icon_url || null,
        })
      } else {
        createMutation.mutate({
          name: value.name,
          sender_email: value.sender_email || undefined,
          sender_name: value.sender_name || undefined,
          image_url: value.image_url || undefined,
          icon_url: value.icon_url || undefined,
        })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      {isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Tenant Information</CardTitle>
            <CardDescription>
              Read-only details about this tenant
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Name</Label>
                <p className="font-medium">{defaultValues.name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <p>{defaultValues.deleted ? "Deleted" : "Active"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{isEdit ? "Edit Tenant" : "Tenant Details"}</CardTitle>
          <CardDescription>
            {isEdit
              ? "Update the tenant's email settings"
              : "Enter the basic information for the new tenant"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
            className="space-y-6"
          >
            {!isEdit && (
              <form.Field
                name="name"
                validators={{
                  onBlur: ({ value }) =>
                    !value ? "Name is required" : undefined,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      placeholder="Acme Corp"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            )}

            <form.Field
              name="sender_email"
              validators={{
                onBlur: ({ value }) => {
                  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                    return "Invalid email address"
                  }
                  return undefined
                },
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="sender_email">Sender Email</Label>
                  <Input
                    id="sender_email"
                    placeholder="noreply@acme.com"
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    The email address used for sending notifications
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="sender_name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="sender_name">Sender Name</Label>
                  <Input
                    id="sender_name"
                    placeholder="Acme Events"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    The display name for outgoing emails
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="image_url">
              {(field) => (
                <div className="space-y-2">
                  <Label>Cover Image</Label>
                  <ImageUpload
                    value={field.state.value || null}
                    onChange={(url) => field.handleChange(url ?? "")}
                  />
                  <p className="text-sm text-muted-foreground">
                    Main image for the tenant branding
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="icon_url">
              {(field) => (
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <ImageUpload
                    value={field.state.value || null}
                    onChange={(url) => field.handleChange(url ?? "")}
                  />
                  <p className="text-sm text-muted-foreground">
                    Small icon used in navigation and listings
                  </p>
                </div>
              )}
            </form.Field>

            <div className="flex gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/tenants" })}
              >
                Cancel
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {isEdit ? "Save Changes" : "Create Tenant"}
              </LoadingButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEdit && (
        <DangerZone
          description="Once you delete this tenant, all associated data will be permanently removed. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Tenant"
          resourceName={defaultValues.name}
        />
      )}
    </div>
  )
}
