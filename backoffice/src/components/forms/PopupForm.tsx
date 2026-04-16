import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Baby,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  Image,
  Key,
  Languages,
  Lock,
  Mail,
  MapPin,
  Scale,
  ShoppingCart,
  Ticket,
  Twitter,
} from "lucide-react"
import {
  ApprovalStrategiesService,
  type PopupAdmin,
  type PopupCreate,
  PopupsService,
  type PopupUpdate,
  type SaleType,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { FormErrorSummary } from "@/components/Common/FormErrorSummary"
import { ApprovalStrategyForm } from "@/components/forms/ApprovalStrategyForm"
import { ReviewersManager } from "@/components/forms/ReviewersManager"
import { ThemeConfigForm } from "@/components/forms/ThemeConfigForm"
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
] as const

const AVAILABLE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "zh", label: "中文" },
] as const

const SALE_TYPE_COPY = {
  application: {
    label: "Popup / application flow",
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
    onSuccess: (data) => {
      showSuccessToast("Event created successfully", {
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
      showSuccessToast("Event updated successfully")
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
      showSuccessToast("Event deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
      navigate({ to: "/popups" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const formatDateForInput = (date: string | null | undefined) => {
    if (!date) return ""
    return date.slice(0, 10)
  }

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      tagline: defaultValues?.tagline ?? "",
      location: defaultValues?.location ?? "",
      status: defaultValues?.status ?? "draft",
      sale_type: (defaultValues?.sale_type ?? "application") as SaleType,
      start_date: formatDateForInput(defaultValues?.start_date),
      end_date: formatDateForInput(defaultValues?.end_date),
      allows_spouse: defaultValues?.allows_spouse ?? false,
      allows_children: defaultValues?.allows_children ?? false,
      allows_coupons: defaultValues?.allows_coupons ?? false,
      allows_scholarship: defaultValues?.allows_scholarship ?? false,
      allows_incentive: defaultValues?.allows_incentive ?? false,
      requires_application_fee:
        defaultValues?.requires_application_fee ?? false,
      application_fee_amount: defaultValues?.application_fee_amount ?? "",
      image_url: defaultValues?.image_url ?? "",
      icon_url: defaultValues?.icon_url ?? "",
      express_checkout_background:
        defaultValues?.express_checkout_background ?? "",
      web_url: defaultValues?.web_url ?? "",
      blog_url: defaultValues?.blog_url ?? "",
      twitter_url: defaultValues?.twitter_url ?? "",
      terms_and_conditions_url: defaultValues?.terms_and_conditions_url ?? "",
      simplefi_api_key: defaultValues?.simplefi_api_key ?? "",
      invoice_company_name: defaultValues?.invoice_company_name ?? "",
      invoice_company_address: defaultValues?.invoice_company_address ?? "",
      invoice_company_email: defaultValues?.invoice_company_email ?? "",
      default_language: defaultValues?.default_language ?? "en",
      supported_languages: defaultValues?.supported_languages ?? ["en"],
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
        allows_spouse: value.allows_spouse,
        allows_children: value.allows_children,
        allows_coupons: value.allows_coupons,
        allows_scholarship: value.allows_scholarship,
        allows_incentive: value.allows_incentive,
        requires_application_fee: value.requires_application_fee,
        application_fee_amount: value.requires_application_fee
          ? value.application_fee_amount || null
          : null,
        image_url: value.image_url || null,
        icon_url: value.icon_url || null,
        express_checkout_background: value.express_checkout_background || null,
        web_url: value.web_url || null,
        blog_url: value.blog_url || null,
        twitter_url: value.twitter_url || null,
        terms_and_conditions_url: value.terms_and_conditions_url || null,
        simplefi_api_key: value.simplefi_api_key || null,
        invoice_company_name: value.invoice_company_name || null,
        invoice_company_address: value.invoice_company_address || null,
        invoice_company_email: value.invoice_company_email || null,
        default_language: value.default_language,
        supported_languages: value.supported_languages,
      }
      if (isEdit) {
        // sale_type is immutable — never sent on update (backend would 422)
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate({
          ...payload,
          sale_type: value.sale_type,
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
          if (!readOnly) {
            form.handleSubmit()
          }
        }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <FormErrorSummary
          form={form}
          fieldLabels={{
            name: "Event Name",
            tagline: "Tagline",
            location: "Location",
            slug: "Slug",
            start_date: "Start Date",
            end_date: "End Date",
          }}
        />

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
                  placeholder="Event Name"
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
                  placeholder="Event location or venue"
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
                        field.state.value === "active" ? "default" : "secondary"
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

        {/* Sale Model — keep commerce decisions near the event identity,
            like the previous implementation. */}
        <div className="space-y-3">
          <div className="space-y-1 px-1">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Commerce setup
            </h3>
            <p className="text-sm text-muted-foreground">
              Decide how people will access this event. This is the primary
              identity of the popup and cannot be changed after creation.
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
                      ? "Sale type cannot be changed after creation"
                      : "Choose whether people apply first or buy tickets directly"
                  }
                >
                  <Select
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange(value as SaleType)
                    }
                    disabled={readOnly || isEdit}
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
        </div>

        <Separator />

        {/* Event Details */}
        <InlineSection title="Event Details">
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
                  icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
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

        <Separator />

        {/* Event Options */}
        <InlineSection title="Event Options">
          <form.Field name="allows_spouse">
            {(field) => (
              <InlineRow
                icon={<Heart className="h-4 w-4 text-muted-foreground" />}
                label="Spouse Registration"
                description="Attendees can register their spouse"
              >
                <Switch
                  id="allows_spouse"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="allows_children">
            {(field) => (
              <InlineRow
                icon={<Baby className="h-4 w-4 text-muted-foreground" />}
                label="Children Registration"
                description="Attendees can register their children"
              >
                <Switch
                  id="allows_children"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="allows_coupons">
            {(field) => (
              <InlineRow
                icon={<Ticket className="h-4 w-4 text-muted-foreground" />}
                label="Discount Coupons"
                description="Enable discount coupons for this event"
              >
                <Switch
                  id="allows_coupons"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="allows_scholarship">
            {(field) => (
              <InlineRow
                icon={
                  <GraduationCap className="h-4 w-4 text-muted-foreground" />
                }
                label="Scholarship Requests"
                description="Allow applicants to request financial assistance"
              >
                <Switch
                  id="allows_scholarship"
                  checked={!!field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.allows_scholarship}>
            {(allowsScholarship) =>
              allowsScholarship ? (
                <form.Field name="allows_incentive">
                  {(field) => (
                    <InlineRow
                      icon={
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                      }
                      label="Cash Incentives"
                      description="Allow assigning a cash grant alongside scholarship approval"
                    >
                      <Switch
                        id="allows_incentive"
                        checked={!!field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked)
                        }
                        disabled={readOnly}
                      />
                    </InlineRow>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>

          <form.Field name="requires_application_fee">
            {(field) => (
              <InlineRow
                icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
                label="Require Application Fee"
                description="Applicants must pay a fee before their application is reviewed"
              >
                <Switch
                  id="requires_application_fee"
                  checked={!!field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => state.values.requires_application_fee}
          >
            {(requiresFee) =>
              requiresFee ? (
                <form.Field name="application_fee_amount">
                  {(field) => (
                    <InlineRow
                      icon={
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                      }
                      label="Fee Amount (USD)"
                      description="Amount in USD that applicants must pay"
                    >
                      <Input
                        id="application_fee_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
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

          <form.Field name="express_checkout_background">
            {(field) => (
              <div className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Image className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Checkout Background</p>
                    <p className="text-xs text-muted-foreground">
                      Full-screen background for checkout, invite, and success
                      pages. Falls back to Cover Image, then tenant background.
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
        </InlineSection>

        {/* Portal Theme (edit only). The form is `mx-auto max-w-2xl` (672px),
            but the theme section needs more horizontal room for the side-by-side
            preview panel. Negative margins on lg+ widen this single section
            without breaking the rest of the form's column. The parent route
            container is `max-w-7xl` with `p-6 md:p-8`, so -mx-32 (128px) at lg
            and -mx-48 (192px) at xl stay safely inside the page padding. */}
        {isEdit && (
          <>
            <Separator />
            <div className="lg:-mx-32 xl:-mx-48">
              <ThemeConfigForm
                popupId={defaultValues!.id}
                themeConfig={
                  defaultValues!.theme_config as Record<string, unknown> | null
                }
                readOnly={readOnly}
              />
            </div>
          </>
        )}

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
                icon={<FileText className="h-4 w-4 text-muted-foreground" />}
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
                icon={<Twitter className="h-4 w-4 text-muted-foreground" />}
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
        </InlineSection>

        <Separator />

        {/* Invoice Settings */}
        <InlineSection title="Invoice Settings">
          <form.Field name="invoice_company_name">
            {(field) => (
              <InlineRow
                icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
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

        <Separator />

        {/* Languages */}
        <InlineSection title="Languages">
          <form.Field name="default_language">
            {(field) => (
              <InlineRow
                icon={<Languages className="h-4 w-4 text-muted-foreground" />}
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
                              current.filter((l: string) => l !== lang.value),
                            )
                          }
                        }}
                      />
                      <Label htmlFor={`lang-${lang.value}`}>{lang.label}</Label>
                    </div>
                  ))}
                </div>
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        {/* Approval strategy + Reviewers (edit only, application sale_type only —
            direct-sale popups have no application flow, so these are meaningless) */}
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

        {isEdit && (defaultValues?.supported_languages?.length ?? 0) > 1 && (
          <>
            <Separator />
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
          </>
        )}

        <Separator />

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

      {isEdit && !readOnly && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this event, all associated products, groups, coupons, and attendee data will be permanently removed. This action cannot be undone."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Event"
            resourceName={defaultValues.name}
            variant="inline"
          />
        </div>
      )}

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
