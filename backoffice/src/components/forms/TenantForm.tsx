import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Building2, Mail } from "lucide-react"

import {
  type TenantCreate,
  type TenantPublic,
  TenantsService,
  type TenantUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { Badge } from "@/components/ui/badge"
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
import { Separator } from "@/components/ui/separator"
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
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-6"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Form Fields */}
          <div className="space-y-6 lg:col-span-2">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {isEdit ? "Basic Information" : "Tenant Details"}
                </CardTitle>
                <CardDescription>
                  {isEdit
                    ? "Update the tenant's configuration"
                    : "Enter the basic information for the new tenant"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field
                    name="sender_email"
                    validators={{
                      onBlur: ({ value }) => {
                        if (
                          value &&
                          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                        ) {
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
                          Email for notifications
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
                          Display name for emails
                        </p>
                      </div>
                    )}
                  </form.Field>
                </div>
              </CardContent>
            </Card>

            {/* Branding */}
            <Card>
              <CardHeader>
                <CardTitle>Branding</CardTitle>
                <CardDescription>
                  Upload images for tenant branding
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field name="image_url">
                  {(field) => (
                    <div className="space-y-2">
                      <Label>Cover Image</Label>
                      <ImageUpload
                        value={field.state.value || null}
                        onChange={(url) => field.handleChange(url ?? "")}
                      />
                      <p className="text-sm text-muted-foreground">
                        Main image for tenant branding
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
                        Small icon for navigation
                      </p>
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex gap-4">
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
          </div>

          {/* Right Column - Preview */}
          <div className="space-y-6">
            <form.Subscribe
              selector={(state) => ({
                name: state.values.name,
                sender_email: state.values.sender_email,
                sender_name: state.values.sender_name,
                icon_url: state.values.icon_url,
              })}
            >
              {(values) => (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Preview</CardTitle>
                    <CardDescription>
                      How this tenant will appear
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-3">
                      {values.icon_url ? (
                        <img
                          src={values.icon_url}
                          alt="Icon"
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 space-y-1">
                        <p className="font-medium leading-none">
                          {isEdit
                            ? defaultValues?.name
                            : values.name || "Tenant Name"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Organization
                        </p>
                      </div>
                    </div>

                    {(values.sender_email || values.sender_name) && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-4 w-4" />
                            <span className="text-sm">Email Settings</span>
                          </div>
                          {values.sender_name && (
                            <p className="text-sm">
                              From: {values.sender_name}
                            </p>
                          )}
                          {values.sender_email && (
                            <p className="text-sm text-muted-foreground">
                              {values.sender_email}
                            </p>
                          )}
                        </div>
                      </>
                    )}

                    {isEdit && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Status
                          </span>
                          <Badge
                            variant={
                              defaultValues?.deleted ? "destructive" : "default"
                            }
                          >
                            {defaultValues?.deleted ? "Deleted" : "Active"}
                          </Badge>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </form.Subscribe>

            {isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tenant Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-medium">{defaultValues.name}</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">Tenant ID</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {defaultValues.id}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </form>

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
