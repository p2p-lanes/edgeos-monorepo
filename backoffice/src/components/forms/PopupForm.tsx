import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Building2,
  Calendar,
  CalendarDays,
  CalendarX,
  Coins,
  DollarSign,
  FileText,
  Globe,
  Image,
  Key,
  Languages,
  Link as LinkIcon,
  Lock,
  Mail,
  MapPin,
  QrCode,
  Scale,
  Share2,
  ShoppingCart,
  Users,
} from "lucide-react"
import {
  ApprovalStrategiesService,
  type CheckoutMode,
  type PopupAdmin,
  type PopupCreate,
  PopupsService,
  type PopupUpdate,
  type SaleType,
  type SimpleFiSuccessBehavior,
} from "@/client"
import { AttendeeCategoriesEditor } from "@/components/attendee-categories/AttendeeCategoriesEditor"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { FormErrorSummary } from "@/components/Common/FormErrorSummary"
import { ApprovalStrategyForm } from "@/components/forms/ApprovalStrategyForm"
import { getMissingLaunchFields } from "@/components/forms/popupLaunchChecklist"
import { ReviewersManager } from "@/components/forms/ReviewersManager"
import { TranslationManager } from "@/components/translations/TranslationManager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { ImageUpload } from "@/components/ui/image-upload"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface PopupFormProps {
  defaultValues?: PopupAdmin
  onSuccess: () => void
}

const POPUP_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "ended", label: "Ended" },
] as const

const AVAILABLE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "zh", label: "中文" },
  { value: "is", label: "Íslenska" },
] as const

const CURRENCIES = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "ARS", label: "ARS — Argentine Peso" },
  { value: "EUR", label: "EUR — Euro" },
] as const

const SALE_TYPE_COPY = {
  application: {
    label: "Gathering / application flow",
    description:
      "People apply first. Use this when you need review workflows, companions, or applicant-specific options.",
  },
  direct: {
    label: "Festival / direct ticketing",
    description:
      "People buy directly. Use this when tickets behave like a shared catalog without family-specific attendee pricing.",
  },
} as const

function getSaleTypeGuidance(saleType: SaleType) {
  if (saleType === "application") {
    return {
      title: "Buyers will apply first",
      description:
        "Applicants go through a structured review flow. You'll be able to configure approval strategies, reviewers, companions, and applicant-specific options.",
    }
  }

  return {
    title: "Buyers will purchase tickets directly",
    description:
      "Tickets behave like a shared catalog. No application flow, no reviewers — logged-in buyers pick from your product list and pay.",
  }
}

function deriveCheckoutMode(saleType: SaleType): CheckoutMode {
  return saleType === "direct" ? "simple_quantity" : "pass_system"
}

export function PopupForm({ defaultValues, onSuccess }: PopupFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast, showWarningToast } =
    useCustomToast()
  const { isOperatorOrAbove } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove

  const createMutation = useMutation({
    mutationFn: (data: PopupCreate) =>
      PopupsService.createPopup({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Gathering created successfully", {
        label: "View",
        onClick: () =>
          navigate({ to: "/popups/$id/edit", params: { id: data.id } }),
      })
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: PopupUpdate) =>
      PopupsService.updatePopup({
        popupId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Gathering updated successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => PopupsService.deletePopup({ popupId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Gathering deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      navigate({ to: "/popups" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  // UI-only enable state per reminder type. The persisted switch is the delay
  // column (null = off); toggling on seeds a default delay, toggling off
  // clears the whole block so the save payload nulls it.

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      tagline: defaultValues?.tagline ?? "",
      location: defaultValues?.location ?? "",
      status: defaultValues?.status ?? "draft",
      sale_type: (defaultValues?.sale_type ?? "application") as SaleType,
      checkout_mode: (defaultValues?.checkout_mode ??
        deriveCheckoutMode(
          defaultValues?.sale_type ?? "application",
        )) as CheckoutMode,
      start_date: formatDateForInput(defaultValues?.start_date),
      end_date: formatDateForInput(defaultValues?.end_date),
      image_url: defaultValues?.image_url ?? "",
      icon_url: defaultValues?.icon_url ?? "",
      favicon_url: defaultValues?.favicon_url ?? "",
      express_checkout_background:
        defaultValues?.express_checkout_background ?? "",
      currency: defaultValues?.currency ?? "USD",
      web_url: defaultValues?.web_url ?? "",
      blog_url: defaultValues?.blog_url ?? "",
      twitter_url: defaultValues?.twitter_url ?? "",
      terms_and_conditions_url: defaultValues?.terms_and_conditions_url ?? "",
      simplefi_api_key: defaultValues?.simplefi_api_key ?? "",
      simplefi_success_behavior: (defaultValues?.simplefi_success_behavior ??
        "manual") as SimpleFiSuccessBehavior,
      invoice_company_name: defaultValues?.invoice_company_name ?? "",
      invoice_company_address: defaultValues?.invoice_company_address ?? "",
      invoice_company_email: defaultValues?.invoice_company_email ?? "",
      default_language: defaultValues?.default_language ?? "en",
      supported_languages: defaultValues?.supported_languages ?? ["en"],
      events_enabled: defaultValues?.events_enabled ?? true,
      edit_passes_enabled: defaultValues?.edit_passes_enabled ?? false,
      self_check_in_enabled: defaultValues?.self_check_in_enabled ?? false,
      show_attendee_directory: defaultValues?.show_attendee_directory ?? false,
      referrals_enabled: defaultValues?.referrals_enabled ?? false,
      group_private_events_enabled:
        defaultValues?.group_private_events_enabled ?? false,
      max_referrals_per_attendee:
        defaultValues?.max_referrals_per_attendee?.toString() ?? "10",
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      const toUTCDate = (dateStr: string) => {
        if (!dateStr) return null
        return `${dateStr.slice(0, 10)}T00:00:00.000Z`
      }
      const payload = {
        name: value.name,
        tagline: value.tagline || null,
        location: value.location || null,
        status: value.status as PopupCreate["status"],
        start_date: toUTCDate(value.start_date),
        end_date: toUTCDate(value.end_date),
        image_url: value.image_url || null,
        icon_url: value.icon_url || null,
        favicon_url: value.favicon_url || null,
        express_checkout_background: value.express_checkout_background || null,
        currency: value.currency,
        web_url: value.web_url || null,
        blog_url: value.blog_url || null,
        twitter_url: value.twitter_url || null,
        terms_and_conditions_url: value.terms_and_conditions_url || null,
        simplefi_api_key: value.simplefi_api_key || null,
        simplefi_success_behavior: value.simplefi_success_behavior,
        invoice_company_name: value.invoice_company_name || null,
        invoice_company_address: value.invoice_company_address || null,
        invoice_company_email: value.invoice_company_email || null,
        default_language: value.default_language,
        supported_languages: value.supported_languages,
        sale_type: value.sale_type,
        events_enabled: value.events_enabled,
        edit_passes_enabled: value.edit_passes_enabled,
        self_check_in_enabled: value.self_check_in_enabled,
        show_attendee_directory:
          value.sale_type === "application" && value.show_attendee_directory,
        referrals_enabled: value.referrals_enabled,
        group_private_events_enabled: value.group_private_events_enabled,
        max_referrals_per_attendee: value.max_referrals_per_attendee
          ? Number(value.max_referrals_per_attendee)
          : null,
      }
      if (value.status === "active") {
        const missing = getMissingLaunchFields(value)
        if (missing.length > 0) {
          showWarningToast(
            "Saved, but not ready to launch",
            <>
              <p>These fields are required before this pop-up can go live:</p>
              <ul className="mt-1 list-disc pl-4">
                {missing.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>,
          )
        }
      }
      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate(payload)
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
          if (!readOnly) {
            form.handleSubmit()
          }
        }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <FormErrorSummary
          form={form}
          fieldLabels={{
            name: "Gathering Name",
            tagline: "Tagline",
            location: "Location",
            slug: "Slug",
            start_date: "Start Date",
            end_date: "End Date",
          }}
        />

        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="commerce">Commerce</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="languages">Languages</TabsTrigger>
          </TabsList>

          {/* ─── General ─────────────────────────────────────────────── */}
          <TabsContent
            value="general"
            forceMount
            className="space-y-6 data-[state=inactive]:hidden"
          >
            {/* Hero: Name + Status */}
            <div className="space-y-3">
              <form.Field
                name="name"
                validators={{
                  onBlur: ({ value }) =>
                    !readOnly && !value ? "Name is required" : undefined,
                }}
              >
                {(field) => (
                  <div>
                    <HeroInput
                      placeholder="Gathering Name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>

              <form.Field name="tagline">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Tagline
                    </Label>
                    <Input
                      placeholder="Short description or slogan"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="text-sm"
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>

              <form.Field name="location">
                {(field) => (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Location
                    </Label>
                    <Input
                      placeholder="Gathering location or venue"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="text-sm"
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>

              <form.Field name="status">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <Select
                      value={field.state.value}
                      onValueChange={(value) =>
                        field.handleChange(value as typeof field.state.value)
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger className="w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                        <Badge
                          variant={
                            field.state.value === "active"
                              ? "default"
                              : "secondary"
                          }
                        >
                          <SelectValue />
                        </Badge>
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
            </div>

            {/* Popup Details - right after identity (edit only) */}
            {isEdit && (
              <div className="flex gap-6 text-sm text-muted-foreground">
                <div>
                  <span className="text-xs uppercase tracking-wider">Slug</span>
                  <p className="font-mono">{defaultValues.slug}</p>
                </div>
              </div>
            )}

            <Separator />

            {/* Event Details */}
            <InlineSection title="Gathering Details">
              <form.Field
                name="start_date"
                validators={{
                  onChange: ({ value }) => {
                    if (readOnly || !value || isEdit) return undefined
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const startDate = new Date(value)
                    startDate.setHours(0, 0, 0, 0)
                    if (startDate < today) {
                      return "Start date must be today or in the future"
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
                      label="Start Date"
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

            {/* Application review — approval strategy + reviewers (edit only,
            application sale_type only — direct-sale popups have no application
            flow, so these are meaningless) */}
            {isEdit && (
              <form.Subscribe selector={(state) => state.values.sale_type}>
                {(saleType) =>
                  saleType === "application" ? (
                    <>
                      <Separator />

                      <ApprovalStrategyForm
                        popupId={defaultValues!.id}
                        readOnly={readOnly}
                        variant="inline"
                      />

                      <Separator />

                      <ConditionalReviewersManager
                        popupId={defaultValues!.id}
                        tenantId={defaultValues!.tenant_id}
                        readOnly={readOnly}
                        variant="inline"
                      />
                    </>
                  ) : null
                }
              </form.Subscribe>
            )}

            {isEdit && !readOnly && (
              <DangerZone
                description="Once you delete this event, all associated products, groups, coupons, and attendee data will be permanently removed. This action cannot be undone."
                onDelete={() => deleteMutation.mutate()}
                isDeleting={deleteMutation.isPending}
                confirmText="Delete Event"
                resourceName={defaultValues.name}
                variant="inline"
              />
            )}
          </TabsContent>

          {/* ─── Commerce ────────────────────────────────────────────── */}
          <TabsContent
            value="commerce"
            forceMount
            className="space-y-6 data-[state=inactive]:hidden"
          >
            {/* Sale Model — keep commerce decisions near the event identity,
            like the previous implementation. */}
            <div className="space-y-3">
              <div className="space-y-1 px-1">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Commerce setup
                </h3>
                <p className="text-sm text-muted-foreground">
                  Decide how people will access this event. This is the primary
                  identity of the popup. Checkout mode is always derived from
                  this choice by the backend.
                </p>
              </div>

              <InlineSection title="How this event sells">
                <form.Field name="sale_type">
                  {(field) => (
                    <InlineRow
                      icon={
                        isEdit ? (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        )
                      }
                      label="Sale Type"
                      description={
                        isEdit
                          ? "Change sale type only if this gathering has no approved payments yet"
                          : "Choose whether people apply first or buy tickets directly"
                      }
                    >
                      <Select
                        value={field.state.value}
                        onValueChange={(value) =>
                          field.handleChange(value as SaleType)
                        }
                        disabled={readOnly}
                      >
                        <SelectTrigger className="w-[220px] text-sm" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="application">
                            {SALE_TYPE_COPY.application.label}
                          </SelectItem>
                          <SelectItem value="direct">
                            {SALE_TYPE_COPY.direct.label}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </InlineRow>
                  )}
                </form.Field>
              </InlineSection>

              <form.Subscribe selector={(state) => state.values.sale_type}>
                {(saleType) => {
                  const copy = SALE_TYPE_COPY[saleType]
                  const guidance = getSaleTypeGuidance(saleType)
                  return (
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <p className="text-sm font-semibold">{copy.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {copy.description}
                      </p>
                      <div className="mt-3 border-t pt-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {guidance.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {guidance.description}
                        </p>
                      </div>
                    </div>
                  )
                }}
              </form.Subscribe>

              <InlineSection>
                <form.Field name="currency">
                  {(field) => (
                    <InlineRow
                      icon={
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                      }
                      label="Currency"
                      description="Currency used for products, fees, invoices, and checkout totals"
                    >
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value)}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="w-[220px] text-sm" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((currency) => (
                            <SelectItem
                              key={currency.value}
                              value={currency.value}
                            >
                              {currency.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </InlineRow>
                  )}
                </form.Field>
              </InlineSection>
            </div>

            <Separator />

            {/* Integrations */}
            <InlineSection title="Integrations">
              <form.Field name="simplefi_api_key">
                {(field) => (
                  <InlineRow
                    icon={<Key className="h-4 w-4 text-muted-foreground" />}
                    label="SimpleFi"
                    description="Payment integration API key"
                  >
                    <Input
                      id="simplefi_api_key"
                      type="password"
                      placeholder="Enter API key"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>
              <form.Field name="simplefi_success_behavior">
                {(field) => (
                  <InlineRow
                    icon={
                      <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    }
                    label="SimpleFi success redirect"
                    description="How the buyer reaches the success URL after paying. Manual keeps them on SimpleFi's checkout until they click through; automatic redirects them immediately."
                  >
                    <Select
                      value={field.state.value}
                      onValueChange={(v) =>
                        field.handleChange(v as SimpleFiSuccessBehavior)
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger
                        id="simplefi_success_behavior"
                        className="w-[140px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="automatic">Automatic</SelectItem>
                      </SelectContent>
                    </Select>
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Invoice Settings */}
            <InlineSection title="Invoice Settings">
              <form.Field name="invoice_company_name">
                {(field) => (
                  <InlineRow
                    icon={
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Company Name"
                  >
                    <Input
                      id="invoice_company_name"
                      placeholder="Acme Inc"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="invoice_company_address">
                {(field) => (
                  <InlineRow
                    icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
                    label="Address"
                  >
                    <Input
                      id="invoice_company_address"
                      placeholder="123 Main St, City, Country"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="invoice_company_email">
                {(field) => (
                  <InlineRow
                    icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                    label="Email"
                  >
                    <Input
                      id="invoice_company_email"
                      type="email"
                      placeholder="billing@example.com"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>
          </TabsContent>

          {/* ─── Features ────────────────────────────────────────────── */}
          <TabsContent
            value="features"
            forceMount
            className="space-y-6 data-[state=inactive]:hidden"
          >
            {/* Event Options */}

            {/* Self-service check-in feature flag */}
            <InlineSection title="Self-service check-in">
              <form.Field name="self_check_in_enabled">
                {(field) => (
                  <InlineRow
                    icon={<QrCode className="h-4 w-4 text-muted-foreground" />}
                    label="Enable attendee self check-in"
                    description="Allow authenticated attendees to check themselves in from the hidden QR-code portal page."
                  >
                    <Switch
                      id="self_check_in_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      disabled={readOnly}
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Attendee directory feature flag */}
            <form.Subscribe selector={(state) => state.values.sale_type}>
              {(saleType) =>
                saleType === "application" ? (
                  <>
                    <InlineSection title="Attendee directory">
                      <form.Field name="show_attendee_directory">
                        {(field) => (
                          <InlineRow
                            icon={
                              <Users className="h-4 w-4 text-muted-foreground" />
                            }
                            label="Show attendee directory"
                            description="Show the directory in the portal for accepted applicants."
                          >
                            <Switch
                              id="show_attendee_directory"
                              checked={field.state.value}
                              onCheckedChange={(checked) =>
                                field.handleChange(checked)
                              }
                              disabled={readOnly}
                            />
                          </InlineRow>
                        )}
                      </form.Field>
                    </InlineSection>

                    <Separator />
                  </>
                ) : null
              }
            </form.Subscribe>

            {/* Events module feature flag */}
            <InlineSection title="Events module">
              <form.Field name="events_enabled">
                {(field) => (
                  <InlineRow
                    icon={
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Enable events module"
                    description="Show the Events section in the portal (calendar, venues, RSVPs). When off, the entire section is hidden — to only block creating new events without hiding existing ones, use the Event Settings page instead."
                  >
                    <Switch
                      id="events_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      disabled={readOnly}
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Groups and Invites feature flags */}
            <InlineSection title="Groups and Invites">
              <form.Field name="referrals_enabled">
                {(field) => (
                  <InlineRow
                    icon={<Share2 className="h-4 w-4 text-muted-foreground" />}
                    label="Enable Referrals"
                    description="Allow attendees to create referral codes and refer others"
                  >
                    <Switch
                      id="referrals_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      disabled={readOnly}
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Subscribe
                selector={(state) => state.values.referrals_enabled}
              >
                {(referralsEnabled) =>
                  referralsEnabled ? (
                    <form.Field name="max_referrals_per_attendee">
                      {(field) => (
                        <InlineRow
                          icon={
                            <Share2 className="h-4 w-4 text-muted-foreground" />
                          }
                          label="Max referrals per attendee"
                          description="How many people each attendee can refer (their referral link's use limit). Leave empty for unlimited."
                        >
                          <Input
                            id="max_referrals_per_attendee"
                            type="number"
                            min="1"
                            step="1"
                            placeholder="e.g. 10"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={readOnly}
                            className="max-w-[120px] text-sm"
                          />
                        </InlineRow>
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>

              <form.Field name="group_private_events_enabled">
                {(field) => (
                  <InlineRow
                    icon={
                      <CalendarX className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Enable Group Private Events"
                    description="Allow group members to create private events scoped to their group"
                  >
                    <Switch
                      id="group_private_events_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      disabled={readOnly}
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Pass editing feature flag */}
            <InlineSection title="Pass Editing">
              <form.Field name="edit_passes_enabled">
                {(field) => (
                  <InlineRow
                    icon={<Coins className="h-4 w-4 text-muted-foreground" />}
                    label="Enable pass editing"
                    description="Allow attendees to edit their already-purchased passes during checkout. Giving up a pass returns its value as credit toward a new one."
                  >
                    <Switch
                      id="edit_passes_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      disabled={readOnly}
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            {/* Companion Types — only available when editing an existing popup */}
            {isEdit && defaultValues && (
              <>
                <Separator />

                <AttendeeCategoriesEditor
                  popupId={defaultValues.id}
                  readOnly={readOnly}
                />
              </>
            )}
          </TabsContent>

          {/* ─── Branding ────────────────────────────────────────────── */}
          <TabsContent
            value="branding"
            forceMount
            className="space-y-6 data-[state=inactive]:hidden"
          >
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
                        <p className="text-sm font-medium">Cover Image</p>
                        <p className="text-xs text-muted-foreground">
                          Main event image used in cards, tickets, application
                          headers, invoices, and emails
                        </p>
                      </div>
                    </div>
                    <ImageUpload
                      value={field.state.value || null}
                      onChange={(url) => field.handleChange(url ?? "")}
                      disabled={readOnly}
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
                          Small icon shown in the portal sidebar popup menu
                        </p>
                      </div>
                    </div>
                    <ImageUpload
                      value={field.state.value || null}
                      onChange={(url) => field.handleChange(url ?? "")}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="favicon_url">
                {(field) => (
                  <div className="space-y-2 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Favicon</p>
                        <p className="text-xs text-muted-foreground">
                          Browser tab icon shown on the public checkout for this
                          popup. Overrides the tenant default.
                        </p>
                      </div>
                    </div>
                    <ImageUpload
                      value={field.state.value || null}
                      onChange={(url) => field.handleChange(url ?? "")}
                      disabled={readOnly}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="express_checkout_background">
                {(field) => (
                  <div className="space-y-2 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          Checkout Background
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Full-screen background for checkout, invite, and
                          success pages. Image or MP4 video (autoplay + audio
                          toggle). Falls back to Cover Image, then tenant
                          background.
                        </p>
                      </div>
                    </div>
                    <ImageUpload
                      value={field.state.value || null}
                      onChange={(url) => field.handleChange(url ?? "")}
                      disabled={readOnly}
                      accept="image+video"
                    />
                  </div>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Links */}
            <InlineSection title="Links">
              <form.Field name="web_url">
                {(field) => (
                  <InlineRow
                    icon={<Globe className="h-4 w-4 text-muted-foreground" />}
                    label="Website"
                  >
                    <Input
                      id="web_url"
                      type="url"
                      placeholder="https://example.com"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="blog_url">
                {(field) => (
                  <InlineRow
                    icon={
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Blog"
                  >
                    <Input
                      id="blog_url"
                      type="url"
                      placeholder="https://example.com/blog"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="twitter_url">
                {(field) => (
                  <InlineRow
                    icon={
                      <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Twitter"
                  >
                    <Input
                      id="twitter_url"
                      type="url"
                      placeholder="https://twitter.com/example"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="terms_and_conditions_url">
                {(field) => (
                  <InlineRow
                    icon={<Scale className="h-4 w-4 text-muted-foreground" />}
                    label="Terms & Conditions"
                  >
                    <Input
                      id="terms_and_conditions_url"
                      type="url"
                      placeholder="https://example.com/terms"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                      className="max-w-xs text-sm"
                    />
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>
          </TabsContent>

          {/* ─── Languages & Translations ───────────────────────────── */}
          <TabsContent value="languages" className="space-y-6">
            {/* Languages */}
            <InlineSection title="Languages">
              <form.Field name="default_language">
                {(field) => (
                  <InlineRow
                    icon={
                      <Languages className="h-4 w-4 text-muted-foreground" />
                    }
                    label="Default Language"
                    description="The primary language for this event"
                  >
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value)}
                      disabled={readOnly}
                    >
                      <SelectTrigger className="w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABLE_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </InlineRow>
                )}
              </form.Field>

              <form.Field name="supported_languages">
                {(field) => (
                  <InlineRow
                    icon={<Globe className="h-4 w-4 text-muted-foreground" />}
                    label="Supported Languages"
                    description="Languages available in the portal"
                  >
                    <div className="flex flex-col gap-2">
                      {AVAILABLE_LANGUAGES.map((lang) => (
                        <div
                          key={lang.value}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            id={`lang-${lang.value}`}
                            checked={field.state.value.includes(lang.value)}
                            disabled={readOnly}
                            onCheckedChange={(checked) => {
                              const current = field.state.value
                              if (checked) {
                                field.handleChange([...current, lang.value])
                              } else {
                                const defaultLang =
                                  form.getFieldValue("default_language")
                                if (lang.value === defaultLang) return
                                field.handleChange(
                                  current.filter(
                                    (l: string) => l !== lang.value,
                                  ),
                                )
                              }
                            }}
                          />
                          <Label htmlFor={`lang-${lang.value}`}>
                            {lang.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </InlineRow>
                )}
              </form.Field>
            </InlineSection>

            <Separator />

            {/* Translations */}
            {!isEdit ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Save the event first to add translations.
              </div>
            ) : (defaultValues?.supported_languages?.length ?? 0) <= 1 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Enable a second language to translate this event.
              </div>
            ) : (
              <form.Subscribe selector={(state) => state.isDirty}>
                {(isDirty) =>
                  isDirty ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Save your changes first to translate the latest content.
                    </div>
                  ) : (
                    <TranslationManager
                      entityType="popup"
                      entityId={defaultValues!.id}
                      translatableFields={["name", "tagline", "location"]}
                      sourceData={{
                        name: defaultValues!.name,
                        tagline: defaultValues!.tagline,
                        location: defaultValues!.location,
                      }}
                      supportedLanguages={defaultValues!.supported_languages!}
                      defaultLanguage={defaultValues!.default_language!}
                    />
                  )
                }
              </form.Subscribe>
            )}
          </TabsContent>
        </Tabs>

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
              {isEdit ? "Save Changes" : "Create Event"}
            </LoadingButton>
          )}
        </div>
      </form>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function ConditionalReviewersManager({
  popupId,
  tenantId,
  readOnly,
  variant,
}: {
  popupId: string
  tenantId: string
  readOnly?: boolean
  variant?: "card" | "inline"
}) {
  const { data: strategy, isLoading } = useQuery({
    queryKey: ["approval-strategy", popupId],
    queryFn: () => ApprovalStrategiesService.getApprovalStrategy({ popupId }),
    retry: false,
  })

  if (isLoading) return null
  if (!strategy) return null
  if (strategy.strategy_type === "auto_accept") return null

  return (
    <ReviewersManager
      popupId={popupId}
      tenantId={tenantId}
      readOnly={readOnly}
      variant={variant}
    />
  )
}
