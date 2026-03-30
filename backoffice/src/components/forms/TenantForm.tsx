import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Check, Copy, Globe, Image, Info, Lock, Mail, User } from "lucide-react"
import { useState } from "react"
import useAuth from "@/hooks/useAuth"
import {
  type TenantCreate,
  type TenantPublic,
  TenantsService,
  type TenantUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "@/components/ui/image-upload"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

/** Reject hostnames that contain a scheme, path, or port — mirrors backend validator. */
function validateHostname(value: string): string | undefined {
  if (!value) return undefined
  if (value.includes("://") || value.includes("/") || value.includes(":")) {
    return "Enter a plain hostname (no scheme, path, or port). Example: checkout.example.com"
  }
  return undefined
}

interface TenantFormProps {
  defaultValues?: TenantPublic
  onSuccess: () => void
}

const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? ""

export function TenantForm({ defaultValues, onSuccess }: TenantFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isSuperadmin } = useAuth()
  const [copied, setCopied] = useState(false)

  const cnameTarget = defaultValues?.slug && PORTAL_DOMAIN
    ? `${defaultValues.slug}.${PORTAL_DOMAIN}`
    : null

  function copyToClipboard() {
    if (!cnameTarget) return
    navigator.clipboard.writeText(cnameTarget)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: TenantCreate) =>
      TenantsService.createTenant({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Organization created successfully")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: TenantUpdate) =>
      TenantsService.updateTenant({
        tenantId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Organization updated successfully")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const toggleActivationMutation = useMutation({
    mutationFn: (active: boolean) =>
      TenantsService.updateTenant({
        tenantId: defaultValues!.id,
        requestBody: { custom_domain_active: active },
      }),
    onSuccess: (_, active) => {
      showSuccessToast(active ? "Domain activated" : "Domain deactivated")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      TenantsService.deleteTenant({ tenantId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Organization deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["tenants"] })
      navigate({ to: "/organizations" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      sender_email: defaultValues?.sender_email ?? "",
      sender_name: defaultValues?.sender_name ?? "",
      image_url: defaultValues?.image_url ?? "",
      icon_url: defaultValues?.icon_url ?? "",
      logo_url: defaultValues?.logo_url ?? "",
      custom_domain: defaultValues?.custom_domain ?? "",
    },
    onSubmit: ({ value }) => {
      if (isEdit) {
        updateMutation.mutate({
          name: value.name || null,
          sender_email: value.sender_email || null,
          sender_name: value.sender_name || null,
          image_url: value.image_url || null,
          icon_url: value.icon_url || null,
          logo_url: value.logo_url || null,
          // Map empty string to null for domain; never send custom_domain_active
          custom_domain: value.custom_domain || null,
        })
      } else {
        createMutation.mutate({
          name: value.name,
          sender_email: value.sender_email || undefined,
          sender_name: value.sender_name || undefined,
          image_url: value.image_url || undefined,
          icon_url: value.icon_url || undefined,
          logo_url: value.logo_url || undefined,
        })
      }
    },
  })

  const blocker = useUnsavedChanges(form)
  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="mx-auto max-w-2xl space-y-6"
      >
        {/* Hero: Name */}
        <div className="space-y-3">
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) => (!value ? "Name is required" : undefined),
            }}
          >
            {(field) => (
              <div>
                <HeroInput
                  placeholder="Organization Name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        </div>

        <Separator />

        {/* Email Settings */}
        <InlineSection title="Email Settings">
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
              <div>
                <InlineRow
                  icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                  label="Sender Email"
                  description="Email for notifications"
                >
                  <Input
                    placeholder="noreply@acme.com"
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="max-w-xs text-sm"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="sender_name">
            {(field) => (
              <InlineRow
                icon={<User className="h-4 w-4 text-muted-foreground" />}
                label="Sender Name"
                description="Display name for emails"
              >
                <Input
                  placeholder="Acme Events"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="max-w-xs text-sm"
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Branding */}
        <InlineSection title="Branding">
          <form.Field name="image_url">
            {(field) => (
              <div className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Background Image</p>
                    <p className="text-xs text-muted-foreground">
                      Full-screen background for the portal login page
                    </p>
                  </div>
                </div>
                <ImageUpload
                  value={field.state.value || null}
                  onChange={(url) => field.handleChange(url ?? "")}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="logo_url">
            {(field) => (
              <div className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Logo</p>
                    <p className="text-xs text-muted-foreground">
                      Main brand logo shown in the backoffice sidebar and the
                      portal login page
                    </p>
                  </div>
                </div>
                <ImageUpload
                  value={field.state.value || null}
                  onChange={(url) => field.handleChange(url ?? "")}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="icon_url">
            {(field) => (
              <div className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Icon</p>
                    <p className="text-xs text-muted-foreground">
                      Small icon used as the browser favicon and on the portal
                      login page
                    </p>
                  </div>
                </div>
                <ImageUpload
                  value={field.state.value || null}
                  onChange={(url) => field.handleChange(url ?? "")}
                />
              </div>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Custom Domain */}
        {isEdit && (
          <InlineSection title="Custom Domain">
            {/* Domain input */}
            <form.Field
              name="custom_domain"
              validators={{
                onBlur: ({ value }) => validateHostname(value),
                onChange: ({ value }) => validateHostname(value),
              }}
            >
              {(field) => {
                const isActive = !!defaultValues?.custom_domain_active
                return (
                  <div>
                    <InlineRow
                      icon={
                        isActive ? (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        )
                      }
                      label="Custom Domain"
                      description={
                        isActive
                          ? "Deactivate the domain before making changes"
                          : "Hostname only — no scheme, path, or port"
                      }
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="checkout.example.com"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={isActive}
                          className="max-w-xs text-sm"
                        />
                        {field.state.value && (
                          <Badge
                            className={
                              isActive
                                ? "bg-green-100 text-green-800 border-green-200"
                                : "bg-yellow-100 text-yellow-800 border-yellow-200"
                            }
                            variant="outline"
                          >
                            {isActive ? "Active" : "Pending Activation"}
                          </Badge>
                        )}
                        {isSuperadmin && field.state.value && (
                          <LoadingButton
                            type="button"
                            variant={isActive ? "outline" : "default"}
                            size="sm"
                            loading={toggleActivationMutation.isPending}
                            onClick={() => toggleActivationMutation.mutate(!isActive)}
                          >
                            {isActive ? "Deactivate" : "Activate"}
                          </LoadingButton>
                        )}
                      </div>
                    </InlineRow>
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )
              }}
            </form.Field>

            {/* Persistent SSL / DNS warning */}
            <Alert className="border-yellow-200 bg-yellow-50 text-yellow-900 mt-2">
              <Info className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800 space-y-2">
                <p>
                  This domain requires SSL and DNS configuration before it
                  becomes active. Contact support to activate once DNS is
                  configured.
                </p>
                {cnameTarget && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-yellow-700">CNAME target:</span>
                    <code className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-mono text-yellow-900 border border-yellow-200">
                      {cnameTarget}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-yellow-700 hover:text-yellow-900 hover:bg-yellow-100"
                      onClick={copyToClipboard}
                    >
                      {copied
                        ? <Check className="h-3 w-3" />
                        : <Copy className="h-3 w-3" />
                      }
                    </Button>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          </InlineSection>
        )}

        <Separator />

        {/* Form Actions */}
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/organizations" })}
          >
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isPending}>
            {isEdit ? "Save Changes" : "Create Organization"}
          </LoadingButton>
        </div>
      </form>

      {isEdit && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this organization, all associated data will be permanently removed. This action cannot be undone."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Organization"
            resourceName={defaultValues.name}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
