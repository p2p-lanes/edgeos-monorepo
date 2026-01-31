import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Baby,
  Calendar,
  Check,
  Globe,
  Heart,
  Key,
  Sparkles,
  Ticket,
  X,
} from "lucide-react"

import {
  type PopupCreate,
  type PopupPublic,
  PopupsService,
  type PopupUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { ApprovalStrategyForm } from "@/components/forms/ApprovalStrategyForm"
import { ReviewersManager } from "@/components/forms/ReviewersManager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface PopupFormProps {
  defaultValues?: PopupPublic
  onSuccess: () => void
}

const POPUP_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
] as const

export function PopupForm({ defaultValues, onSuccess }: PopupFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const createMutation = useMutation({
    mutationFn: (data: PopupCreate) =>
      PopupsService.createPopup({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Popup created successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: PopupUpdate) =>
      PopupsService.updatePopup({
        popupId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Popup updated successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => PopupsService.deletePopup({ popupId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Popup deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      navigate({ to: "/popups" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  const formatDateForDisplay = (date: string) => {
    if (!date) return "Not set"
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      slug: defaultValues?.slug ?? "",
      status: defaultValues?.status ?? "draft",
      start_date: formatDateForInput(defaultValues?.start_date),
      end_date: formatDateForInput(defaultValues?.end_date),
      allows_spouse: defaultValues?.allows_spouse ?? false,
      allows_children: defaultValues?.allows_children ?? false,
      allows_coupons: defaultValues?.allows_coupons ?? false,
      image_url: defaultValues?.image_url ?? "",
      icon_url: defaultValues?.icon_url ?? "",
      express_checkout_background:
        defaultValues?.express_checkout_background ?? "",
      web_url: defaultValues?.web_url ?? "",
      blog_url: defaultValues?.blog_url ?? "",
      twitter_url: defaultValues?.twitter_url ?? "",
      simplefi_api_key: defaultValues?.simplefi_api_key ?? "",
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      const toUTCDate = (dateStr: string) => {
        if (!dateStr) return null
        return `${dateStr.slice(0, 10)}T00:00:00.000Z`
      }
      const payload = {
        name: value.name,
        slug: value.slug || undefined,
        status: value.status as PopupCreate["status"],
        start_date: toUTCDate(value.start_date),
        end_date: toUTCDate(value.end_date),
        allows_spouse: value.allows_spouse,
        allows_children: value.allows_children,
        allows_coupons: value.allows_coupons,
        image_url: value.image_url || null,
        icon_url: value.icon_url || null,
        express_checkout_background: value.express_checkout_background || null,
        web_url: value.web_url || null,
        blog_url: value.blog_url || null,
        twitter_url: value.twitter_url || null,
        simplefi_api_key: value.simplefi_api_key || null,
      }
      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate(payload)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

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
        className="space-y-6"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Form Fields */}
          <div className="space-y-6 lg:col-span-2">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {readOnly
                    ? "Popup Details"
                    : isEdit
                      ? "Basic Information"
                      : "Popup Details"}
                </CardTitle>
                <CardDescription>
                  {readOnly
                    ? "View popup information (read-only)"
                    : isEdit
                      ? "Update the popup configuration"
                      : "Enter the basic information for the new popup"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field
                  name="name"
                  validators={{
                    onBlur: ({ value }) =>
                      !readOnly && !value ? "Name is required" : undefined,
                  }}
                >
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="name">
                        Name{" "}
                        {!readOnly && (
                          <span className="text-destructive">*</span>
                        )}
                      </Label>
                      <Input
                        id="name"
                        placeholder="My Event 2025"
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

                <form.Field name="status">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) =>
                          field.handleChange(value as typeof field.state.value)
                        }
                        disabled={readOnly}
                      >
                        <SelectTrigger id="status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          {POPUP_STATUSES.map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </form.Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="start_date">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="start_date">Start Date</Label>
                        <DatePicker
                          id="start_date"
                          value={field.state.value}
                          onChange={field.handleChange}
                          disabled={readOnly}
                          placeholder="Select start date"
                        />
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="end_date">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="end_date">End Date</Label>
                        <DatePicker
                          id="end_date"
                          value={field.state.value}
                          onChange={field.handleChange}
                          disabled={readOnly}
                          placeholder="Select end date"
                        />
                      </div>
                    )}
                  </form.Field>
                </div>
              </CardContent>
            </Card>

            {/* Features */}
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>
                  Configure what features are enabled for this popup
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field name="allows_spouse">
                  {(field) => (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="allows_spouse">Allows Spouse</Label>
                        <p className="text-sm text-muted-foreground">
                          Attendees can register their spouse
                        </p>
                      </div>
                      <Switch
                        id="allows_spouse"
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked)
                        }
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="allows_children">
                  {(field) => (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="allows_children">Allows Children</Label>
                        <p className="text-sm text-muted-foreground">
                          Attendees can register their children
                        </p>
                      </div>
                      <Switch
                        id="allows_children"
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked)
                        }
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="allows_coupons">
                  {(field) => (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="allows_coupons">Allows Coupons</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable discount coupons for this popup
                        </p>
                      </div>
                      <Switch
                        id="allows_coupons"
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked)
                        }
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Images */}
            <Card>
              <CardHeader>
                <CardTitle>Images</CardTitle>
                <CardDescription>
                  Upload images for the popup branding
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
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        Main image displayed on the popup page
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
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        Small icon used in navigation and listings
                      </p>
                    </div>
                  )}
                </form.Field>

                <form.Field name="express_checkout_background">
                  {(field) => (
                    <div className="space-y-2">
                      <Label>Express Checkout Background</Label>
                      <ImageUpload
                        value={field.state.value || null}
                        onChange={(url) => field.handleChange(url ?? "")}
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        Background image for the express checkout page
                      </p>
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* URLs & Links */}
            <Card>
              <CardHeader>
                <CardTitle>URLs & Links</CardTitle>
                <CardDescription>
                  External links and resources for this popup
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field name="web_url">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="web_url">Website URL</Label>
                      <Input
                        id="web_url"
                        type="url"
                        placeholder="https://example.com"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="blog_url">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="blog_url">Blog URL</Label>
                      <Input
                        id="blog_url"
                        type="url"
                        placeholder="https://example.com/blog"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="twitter_url">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="twitter_url">Twitter URL</Label>
                      <Input
                        id="twitter_url"
                        type="url"
                        placeholder="https://twitter.com/example"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Integrations */}
            <Card>
              <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>
                  Third-party service configurations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.Field name="simplefi_api_key">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="simplefi_api_key">SimpleFi API Key</Label>
                      <Input
                        id="simplefi_api_key"
                        type="password"
                        placeholder="Enter API key"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        API key for SimpleFi payment integration
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
                onClick={() => navigate({ to: "/popups" })}
              >
                {readOnly ? "Back" : "Cancel"}
              </Button>
              {!readOnly && (
                <LoadingButton type="submit" loading={isPending}>
                  {isEdit ? "Save Changes" : "Create Popup"}
                </LoadingButton>
              )}
            </div>
          </div>

          {/* Right Column - Preview & Details */}
          <div className="space-y-6">
            <form.Subscribe
              selector={(state) => ({
                name: state.values.name,
                status: state.values.status,
                start_date: state.values.start_date,
                end_date: state.values.end_date,
                allows_spouse: state.values.allows_spouse,
                allows_children: state.values.allows_children,
                allows_coupons: state.values.allows_coupons,
                icon_url: state.values.icon_url,
                web_url: state.values.web_url,
                simplefi_api_key: state.values.simplefi_api_key,
              })}
            >
              {(values) => (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Preview</CardTitle>
                    <CardDescription>
                      How this popup will appear
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
                          <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 space-y-1">
                        <p className="font-medium leading-none">
                          {values.name || "Popup Name"}
                        </p>
                        <p className="text-sm text-muted-foreground">Event</p>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Status
                      </span>
                      <Badge
                        variant={
                          values.status === "active" ? "default" : "secondary"
                        }
                      >
                        {values.status === "active" ? "Active" : "Draft"}
                      </Badge>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span className="text-sm">Event Dates</span>
                      </div>
                      <div className="text-sm">
                        {formatDateForDisplay(values.start_date)} -{" "}
                        {formatDateForDisplay(values.end_date)}
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Features</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-sm">
                          {values.allows_spouse ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <Heart className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Spouse Registration</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {values.allows_children ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <Baby className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Children Registration</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {values.allows_coupons ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <Ticket className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Discount Coupons</span>
                        </div>
                      </div>
                    </div>

                    {(values.web_url || values.simplefi_api_key) && (
                      <>
                        <Separator />
                        <div className="space-y-1.5">
                          {values.web_url && (
                            <div className="flex items-center gap-2 text-sm">
                              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="truncate text-muted-foreground">
                                Website configured
                              </span>
                            </div>
                          )}
                          {values.simplefi_api_key && (
                            <div className="flex items-center gap-2 text-sm">
                              <Key className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">
                                SimpleFi configured
                              </span>
                            </div>
                          )}
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
                  <CardTitle className="text-base">Popup Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Slug</p>
                    <p className="font-mono text-sm">{defaultValues.slug}</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">Popup ID</p>
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

      {/* Approval Strategy (only for edit mode) - Full width */}
      {isEdit && (
        <ApprovalStrategyForm popupId={defaultValues!.id} readOnly={readOnly} />
      )}

      {/* Reviewers Manager (only for edit mode) - Full width */}
      {isEdit && (
        <ReviewersManager
          popupId={defaultValues!.id}
          tenantId={defaultValues!.tenant_id}
          readOnly={readOnly}
        />
      )}

      {isEdit && !readOnly && (
        <DangerZone
          description="Once you delete this popup, all associated products, groups, coupons, and attendee data will be permanently removed. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Popup"
          resourceName={defaultValues.name}
        />
      )}
    </div>
  )
}
