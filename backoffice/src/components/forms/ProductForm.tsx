import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Calendar,
  Clock,
  DollarSign,
  Hash,
  Layers,
  Plus,
  Power,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
  PopupsService,
  type ProductCreate,
  type ProductPublicWithTier,
  ProductsService,
  type ProductUpdate,
  type TicketAttendeeCategory,
  type TicketDuration,
  TicketTierGroupsService,
} from "@/client"

type ProductCategory = string

import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { TierGroupPicker } from "@/components/forms/TierGroupPicker"
import { TranslationManager } from "@/components/translations/TranslationManager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface ProductFormProps {
  defaultValues?: ProductPublicWithTier
  onSuccess: () => void
}

const PRODUCT_CATEGORIES: {
  value: ProductCategory
  label: string
}[] = [
  { value: "ticket", label: "Ticket" },
  { value: "housing", label: "Housing" },
  { value: "merch", label: "Merchandise" },
  { value: "other", label: "Other" },
  { value: "patreon", label: "Patreon" },
]

const TICKET_DURATIONS: { value: TicketDuration; label: string }[] = [
  { value: "day", label: "Day Pass" },
  { value: "week", label: "Week Pass" },
  { value: "month", label: "Month Pass" },
  { value: "full", label: "Full Event" },
]

const ATTENDEE_CATEGORIES: { value: TicketAttendeeCategory; label: string }[] =
  [
    { value: "main", label: "Main Attendee" },
    { value: "spouse", label: "Spouse" },
    { value: "kid", label: "Kid" },
  ]

/** Extract YYYY-MM-DD from an ISO date string like "2026-05-10T00:00:00Z" */
const toDateInputValue = (iso?: string | null): string => {
  if (!iso) return ""
  return iso.slice(0, 10)
}

export function ProductForm({ defaultValues, onSuccess }: ProductFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [customCategories, setCustomCategories] = useState<string[]>([])

  const popupId = defaultValues?.popup_id ?? selectedPopupId
  const { data: apiCategories } = useQuery({
    queryKey: ["product-categories", popupId],
    queryFn: () => ProductsService.listProductCategories({ popupId: popupId! }),
    enabled: !!popupId,
  })

  const { data: popupData } = useQuery({
    queryKey: ["popups", popupId],
    queryFn: () => PopupsService.getPopup({ popupId: popupId! }),
    enabled: !!popupId,
  })

  // Tier group state (local until Save)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    defaultValues?.phase?.group_id ?? null,
  )
  const [phaseLabel, setPhaseLabel] = useState(
    defaultValues?.phase?.label ?? "",
  )
  const [phaseSaleStartsAt, setPhaseSaleStartsAt] = useState(
    defaultValues?.phase?.sale_starts_at?.slice(0, 10) ?? "",
  )
  const [phaseSaleEndsAt, setPhaseSaleEndsAt] = useState(
    defaultValues?.phase?.sale_ends_at?.slice(0, 10) ?? "",
  )
  const [tierOverlapError, setTierOverlapError] = useState<string | null>(null)

  // Fetch selected group (for overlap validation)
  const { data: selectedGroupData } = useQuery({
    queryKey: ["tier-groups", selectedGroupId],
    queryFn: () =>
      TicketTierGroupsService.getTierGroup({ groupId: selectedGroupId! }),
    enabled: !!selectedGroupId,
  })

  // Merge hardcoded defaults + API categories + locally added ones (deduplicated)
  const allCategories = useMemo(() => {
    const known = PRODUCT_CATEGORIES.map((c) => c.value)
    const fromApi = apiCategories ?? []
    const merged = [...known]
    for (const cat of [...fromApi, ...customCategories]) {
      if (!merged.includes(cat)) merged.push(cat)
    }
    return merged
  }, [apiCategories, customCategories])

  const createMutation = useMutation({
    mutationFn: (data: ProductCreate) =>
      ProductsService.createProduct({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Product created successfully", {
        label: "View",
        onClick: () =>
          navigate({ to: "/products/$id/edit", params: { id: data.id } }),
      })
      queryClient.invalidateQueries({ queryKey: ["products"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: ProductUpdate) =>
      ProductsService.updateProduct({
        productId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Product updated successfully")
      queryClient.invalidateQueries({ queryKey: ["products"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      ProductsService.deleteProduct({ productId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Product deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["products"] })
      navigate({ to: "/products" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  // ── Tier Phase helpers ─────────────────────────────────────────────────────

  /**
   * Check if the candidate window [starts, ends] overlaps with any existing
   * phase in the selected group (excluding this product's own existing phase).
   */
  const checkOverlap = (starts: string, ends: string): boolean => {
    const phases = selectedGroupData?.phases ?? []
    const currentProductPhaseId = defaultValues?.phase?.id
    const s = new Date(starts).getTime()
    const e = ends ? new Date(ends).getTime() : Number.POSITIVE_INFINITY

    for (const phase of phases) {
      if (phase.id === currentProductPhaseId) continue
      if (!phase.sale_starts_at && !phase.sale_ends_at) continue
      const ps = phase.sale_starts_at
        ? new Date(phase.sale_starts_at).getTime()
        : Number.NEGATIVE_INFINITY
      const pe = phase.sale_ends_at
        ? new Date(phase.sale_ends_at).getTime()
        : Number.POSITIVE_INFINITY
      if (s < pe && e > ps) return true
    }
    return false
  }

  const tierPhaseMutation = useMutation({
    mutationFn: ({
      productId,
      existingPhaseId,
    }: {
      productId: string
      existingPhaseId?: string
    }) => {
      if (existingPhaseId) {
        return TicketTierGroupsService.updateTierPhase({
          groupId: selectedGroupId!,
          phaseId: existingPhaseId,
          requestBody: {
            label: phaseLabel || null,
            sale_starts_at: phaseSaleStartsAt || null,
            sale_ends_at: phaseSaleEndsAt || null,
          },
        })
      }
      return TicketTierGroupsService.createTierPhase({
        groupId: selectedGroupId!,
        requestBody: {
          product_id: productId,
          label: phaseLabel,
          sale_starts_at: phaseSaleStartsAt || null,
          sale_ends_at: phaseSaleEndsAt || null,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tier-groups"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      price: defaultValues?.price?.toString() ?? "",
      description: defaultValues?.description ?? "",
      image_url: defaultValues?.image_url ?? "",
      category: (defaultValues?.category ?? "ticket") as ProductCategory,
      attendee_category: (defaultValues?.attendee_category ??
        "main") as TicketAttendeeCategory,
      duration_type: (defaultValues?.duration_type ?? "full") as TicketDuration,
      is_active: defaultValues?.is_active ?? true,
      exclusive: defaultValues?.exclusive ?? false,
      max_quantity: defaultValues?.max_quantity?.toString() ?? "",
      start_date: toDateInputValue(defaultValues?.start_date),
      end_date: toDateInputValue(defaultValues?.end_date),
      insurance_eligible: defaultValues?.insurance_eligible ?? false,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return

      const isTicket = value.category === "ticket"
      const tierEnabled = !!popupData?.tier_progression_enabled && isTicket
      const hasGroupSelected = tierEnabled && !!selectedGroupId

      // BA-3: client-side overlap validation before calling the API
      if (hasGroupSelected && phaseSaleStartsAt) {
        const overlaps = checkOverlap(phaseSaleStartsAt, phaseSaleEndsAt)
        if (overlaps) {
          setTierOverlapError(
            "The sale window overlaps with another phase in this group. Adjust the dates.",
          )
          return
        }
      }
      setTierOverlapError(null)

      const maxQty = value.max_quantity
        ? Number.parseInt(value.max_quantity, 10)
        : null

      if (isEdit) {
        updateMutation.mutate(
          {
            name: value.name,
            price: value.price,
            description: value.description || null,
            image_url: value.image_url || null,
            category: value.category,
            attendee_category: isTicket ? value.attendee_category : null,
            duration_type: isTicket ? value.duration_type : null,
            start_date: isTicket && value.start_date ? value.start_date : null,
            end_date: isTicket && value.end_date ? value.end_date : null,
            is_active: value.is_active,
            exclusive: value.exclusive,
            max_quantity: maxQty,
            insurance_eligible: value.insurance_eligible,
          },
          {
            onSuccess: () => {
              if (hasGroupSelected) {
                tierPhaseMutation.mutate({
                  productId: defaultValues!.id,
                  existingPhaseId: defaultValues?.phase?.id,
                })
              }
            },
          },
        )
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate(
          {
            popup_id: selectedPopupId,
            name: value.name,
            price: value.price,
            description: value.description || undefined,
            image_url: value.image_url || undefined,
            category: value.category,
            attendee_category: isTicket ? value.attendee_category : undefined,
            duration_type: isTicket ? value.duration_type : undefined,
            start_date:
              isTicket && value.start_date ? value.start_date : undefined,
            end_date: isTicket && value.end_date ? value.end_date : undefined,
            is_active: value.is_active,
            exclusive: value.exclusive,
            max_quantity: maxQty ?? undefined,
            insurance_eligible: value.insurance_eligible,
          },
          {
            onSuccess: (created) => {
              if (hasGroupSelected) {
                tierPhaseMutation.mutate({ productId: created.id })
              }
            },
          },
        )
      }
    },
  })

  const blocker = useUnsavedChanges(form)

  const isPending = createMutation.isPending || updateMutation.isPending

  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="product" action="create" />
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
        {/* Hero: Name + Category Badge */}
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
                  placeholder="Product Name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="category">
            {(field) => (
              <div className="flex items-center gap-2">
                <Select
                  value={field.state.value}
                  onValueChange={(val) => {
                    if (val === "__add_new__") {
                      setNewCategoryName("")
                      setAddCategoryOpen(true)
                      return
                    }
                    field.handleChange(val as ProductCategory)
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                    <Badge variant="secondary">
                      <SelectValue />
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {allCategories.map((cat) => {
                      const known = PRODUCT_CATEGORIES.find(
                        (c) => c.value === cat,
                      )
                      return (
                        <SelectItem key={cat} value={cat}>
                          {known?.label ?? cat}
                        </SelectItem>
                      )
                    })}
                    <SelectItem value="__add_new__" className="text-primary">
                      <span className="flex items-center gap-1.5">
                        <Plus className="h-3.5 w-3.5" />
                        Add category
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
        </div>

        {/* Product Details metadata (edit only) */}
        {isEdit && (
          <div className="flex gap-6 text-sm text-muted-foreground">
            <div>
              <span className="text-xs uppercase tracking-wider">Slug</span>
              <p className="font-mono">{defaultValues.slug}</p>
            </div>
          </div>
        )}

        <Separator />

        {/* Description */}
        <form.Field name="description">
          {(field) => (
            <div className="space-y-2">
              <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </p>
              <Textarea
                placeholder="Product description..."
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={readOnly}
              />
            </div>
          )}
        </form.Field>

        {/* Image */}
        <form.Field name="image_url">
          {(field) => (
            <div className="space-y-2">
              <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Image
              </p>
              <ImageUpload
                value={field.state.value || null}
                onChange={(url) => field.handleChange(url ?? "")}
                disabled={readOnly}
              />
            </div>
          )}
        </form.Field>

        <Separator />

        {/* Pricing & Inventory */}
        <InlineSection title="Pricing & Inventory">
          <form.Field
            name="price"
            validators={{
              onBlur: ({ value }) =>
                !readOnly && !value ? "Price is required" : undefined,
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  }
                  label="Price"
                >
                  <Input
                    placeholder="100.00"
                    type="text"
                    inputMode="decimal"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                    className="max-w-32 text-sm"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field
            name="max_quantity"
            validators={{
              onBlur: ({ value }) => {
                if (readOnly || !value) return undefined
                const num = Number.parseInt(value, 10)
                if (Number.isNaN(num) || num < 1) {
                  return "Max quantity must be a positive number"
                }
                return undefined
              },
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                  label="Max Quantity"
                  description="Leave empty for unlimited"
                >
                  <Input
                    placeholder="Unlimited"
                    type="number"
                    min="1"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                    className="max-w-32 text-sm"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="insurance_eligible">
            {(field) => (
              <InlineRow
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                label="Insurance Eligible"
                description="Include this product in the insurance calculation when popup insurance is enabled"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="insurance_eligible"
                    checked={field.state.value}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked === true)
                    }
                    disabled={readOnly}
                  />
                  <Label htmlFor="insurance_eligible" className="text-sm">
                    Eligible
                  </Label>
                </div>
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="is_active">
            {(field) => (
              <InlineRow
                icon={<Power className="h-4 w-4 text-muted-foreground" />}
                label="Active"
                description="Product is available for purchase"
              >
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="exclusive">
            {(field) => (
              <InlineRow
                icon={<Shield className="h-4 w-4 text-muted-foreground" />}
                label="Exclusive"
                description="Only one exclusive product can be selected at a time"
              >
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        {/* Ticket Options (conditional) */}
        <form.Subscribe selector={(state) => state.values.category}>
          {(category) =>
            category === "ticket" && (
              <>
                <Separator />
                <InlineSection title="Ticket Options">
                  <form.Field name="duration_type">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Duration"
                        description="How long the ticket is valid"
                      >
                        <Select
                          value={field.state.value}
                          onValueChange={(val) =>
                            field.handleChange(val as TicketDuration)
                          }
                          disabled={readOnly}
                        >
                          <SelectTrigger className="w-auto text-sm">
                            <SelectValue placeholder="Select duration" />
                          </SelectTrigger>
                          <SelectContent>
                            {TICKET_DURATIONS.map((dur) => (
                              <SelectItem key={dur.value} value={dur.value}>
                                {dur.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </InlineRow>
                    )}
                  </form.Field>

                  <form.Field name="attendee_category">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Users className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Attendee Type"
                        description="Who can purchase this ticket"
                      >
                        <Select
                          value={field.state.value}
                          onValueChange={(val) =>
                            field.handleChange(val as TicketAttendeeCategory)
                          }
                          disabled={readOnly}
                        >
                          <SelectTrigger className="w-auto text-sm">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            {ATTENDEE_CATEGORIES.map((cat) => (
                              <SelectItem key={cat.value} value={cat.value}>
                                {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </InlineRow>
                    )}
                  </form.Field>

                  <form.Field name="start_date">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Start Date"
                        description="When the ticket validity begins"
                      >
                        <Input
                          type="date"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                          className="max-w-44 text-sm"
                        />
                      </InlineRow>
                    )}
                  </form.Field>

                  <form.Field name="end_date">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="End Date"
                        description="When the ticket validity ends"
                      >
                        <Input
                          type="date"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                          className="max-w-44 text-sm"
                        />
                      </InlineRow>
                    )}
                  </form.Field>
                </InlineSection>
              </>
            )
          }
        </form.Subscribe>

        {/* Tier Group Section — only for tickets when popup flag is on */}
        <form.Subscribe selector={(state) => state.values.category}>
          {(category) =>
            popupData?.tier_progression_enabled &&
            category === "ticket" && (
              <>
                <Separator />
                <InlineSection title="Tier Group">
                  <div className="space-y-3">
                    <p className="px-1 text-xs text-muted-foreground">
                      Assign this ticket to a tier group to enable early-bird /
                      regular / late progression.
                    </p>
                    <TierGroupPicker
                      popupId={popupId!}
                      value={selectedGroupId}
                      onChange={(id) => {
                        setSelectedGroupId(id)
                        setTierOverlapError(null)
                      }}
                      className="max-w-sm"
                    />
                  </div>

                  {selectedGroupId && (
                    <div className="space-y-3 pt-2">
                      <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Phase Details
                      </p>

                      {/* Phase Label */}
                      <InlineRow
                        icon={
                          <Layers className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Phase label"
                        description='E.g. "Early Bird", "Regular"'
                      >
                        <Input
                          id="phase-label"
                          aria-label="Phase label"
                          placeholder="Early Bird"
                          value={phaseLabel}
                          onChange={(e) => setPhaseLabel(e.target.value)}
                          disabled={readOnly}
                          className="max-w-48 text-sm"
                        />
                      </InlineRow>

                      {/* Sale Starts At */}
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Sale starts"
                        description="When this phase opens for purchase"
                      >
                        <Input
                          id="phase-sale-starts-at"
                          aria-label="Sale starts"
                          type="date"
                          value={phaseSaleStartsAt}
                          onChange={(e) => setPhaseSaleStartsAt(e.target.value)}
                          disabled={readOnly}
                          className="max-w-44 text-sm"
                        />
                      </InlineRow>

                      {/* Sale Ends At */}
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Sale ends"
                        description="When this phase closes"
                      >
                        <Input
                          id="phase-sale-ends-at"
                          aria-label="Sale ends"
                          type="date"
                          value={phaseSaleEndsAt}
                          onChange={(e) => setPhaseSaleEndsAt(e.target.value)}
                          disabled={readOnly}
                          className="max-w-44 text-sm"
                        />
                      </InlineRow>

                      {/* Overlap error */}
                      {tierOverlapError && (
                        <p
                          role="alert"
                          className="px-1 text-sm text-destructive"
                        >
                          {tierOverlapError}
                        </p>
                      )}
                    </div>
                  )}
                </InlineSection>
              </>
            )
          }
        </form.Subscribe>

        {isEdit && (popupData?.supported_languages?.length ?? 0) > 1 && (
          <>
            <Separator />
            <TranslationManager
              entityType="product"
              entityId={defaultValues!.id}
              translatableFields={["name", "description"]}
              sourceData={{
                name: defaultValues!.name,
                description: defaultValues!.description,
              }}
              supportedLanguages={popupData!.supported_languages!}
              defaultLanguage={popupData!.default_language!}
            />
          </>
        )}

        <Separator />

        {/* Form Actions */}
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/products" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Product"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this product, it will be permanently removed. Existing purchases will not be affected."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Product"
            resourceName={defaultValues.name}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />

      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>
              Give your category a name. Products with this category can be
              grouped into their own checkout step.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-2">
            <Input
              placeholder="e.g. workshops, vip-extras"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  const trimmed = newCategoryName.trim().toLowerCase()
                  if (trimmed) {
                    if (!allCategories.includes(trimmed)) {
                      setCustomCategories((prev) => [...prev, trimmed])
                    }
                    form.setFieldValue("category", trimmed as ProductCategory)
                    setAddCategoryOpen(false)
                  }
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setAddCategoryOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!newCategoryName.trim()}
                onClick={() => {
                  const trimmed = newCategoryName.trim().toLowerCase()
                  if (trimmed) {
                    if (!allCategories.includes(trimmed)) {
                      setCustomCategories((prev) => [...prev, trimmed])
                    }
                    form.setFieldValue("category", trimmed as ProductCategory)
                    setAddCategoryOpen(false)
                  }
                }}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
