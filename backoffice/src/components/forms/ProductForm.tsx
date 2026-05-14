import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Calendar,
  Clock,
  DollarSign,
  Hash,
  Plus,
  Power,
  QrCode,
  Shield,
  ShieldCheck,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
  PopupsService,
  type ProductCreate,
  type ProductPublic,
  ProductsService,
  type ProductUpdate,
  type TicketDuration,
} from "@/client"

type ProductCategory = string

import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { TranslationManager } from "@/components/translations/TranslationManager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
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
  defaultValues?: ProductPublic
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

export function ProductForm({ defaultValues, onSuccess }: ProductFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove

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

  const { data: existingProducts } = useQuery({
    queryKey: ["products", popupId, { page: 0, pageSize: 100 }],
    queryFn: () =>
      ProductsService.listProducts({ popupId: popupId!, limit: 100 }),
    enabled: !!popupId,
  })

  const hasActivePatreonProduct = (existingProducts?.results ?? []).some(
    (p) =>
      p.category === "patreon" &&
      p.is_active &&
      // When editing: exclude the current product so the owner can still save
      p.id !== defaultValues?.id,
  )

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

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      price: defaultValues?.price?.toString() ?? "",
      compare_price: defaultValues?.compare_price?.toString() ?? "",
      description: defaultValues?.description ?? "",
      image_url: defaultValues?.image_url ?? "",
      category: (defaultValues?.category ?? "ticket") as ProductCategory,
      duration_type: (defaultValues?.duration_type ?? "full") as TicketDuration,
      requires_check_in:
        defaultValues?.requires_check_in ??
        (defaultValues?.category ?? "ticket") === "ticket",
      is_active: defaultValues?.is_active ?? true,
      exclusive: defaultValues?.exclusive ?? false,
      total_stock_cap: defaultValues?.total_stock_cap?.toString() ?? "",
      max_per_order: defaultValues?.max_per_order?.toString() ?? "",
      sale_starts_at: defaultValues?.sale_starts_at ?? "",
      sale_ends_at: defaultValues?.sale_ends_at ?? "",
      insurance_eligible: defaultValues?.insurance_eligible ?? false,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return

      const isPatreon = value.category === "patreon"
      const isTicket = value.category === "ticket"
      // Defense in depth: backend also enforces price=0 for patreon products
      const effectivePrice = isPatreon ? "0" : value.price
      const effectiveComparePrice =
        isPatreon || !value.compare_price ? null : value.compare_price

      const totalStockCap = value.total_stock_cap
        ? Number.parseInt(value.total_stock_cap, 10)
        : null
      const maxPerOrder = value.max_per_order
        ? Number.parseInt(value.max_per_order, 10)
        : null

      if (isEdit) {
        updateMutation.mutate({
          name: value.name,
          price: effectivePrice,
          compare_price: effectiveComparePrice,
          description: value.description || null,
          image_url: value.image_url || null,
          category: value.category,
          duration_type: isTicket ? value.duration_type : null,
          sale_starts_at:
            isTicket && value.sale_starts_at ? value.sale_starts_at : null,
          sale_ends_at:
            isTicket && value.sale_ends_at ? value.sale_ends_at : null,
          requires_check_in: value.requires_check_in,
          is_active: value.is_active,
          exclusive: value.exclusive,
          total_stock_cap: totalStockCap,
          max_per_order: maxPerOrder,
          insurance_eligible: value.insurance_eligible,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          name: value.name,
          price: effectivePrice,
          compare_price: effectiveComparePrice ?? undefined,
          description: value.description || undefined,
          image_url: value.image_url || undefined,
          category: value.category,
          duration_type: isTicket ? value.duration_type : undefined,
          sale_starts_at:
            isTicket && value.sale_starts_at ? value.sale_starts_at : undefined,
          sale_ends_at:
            isTicket && value.sale_ends_at ? value.sale_ends_at : undefined,
          requires_check_in: value.requires_check_in,
          is_active: value.is_active,
          exclusive: value.exclusive,
          total_stock_cap: totalStockCap ?? undefined,
          max_per_order: maxPerOrder ?? undefined,
          insurance_eligible: value.insurance_eligible,
        })
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
                      const isDisabled =
                        cat === "patreon" && hasActivePatreonProduct
                      return (
                        <SelectItem
                          key={cat}
                          value={cat}
                          disabled={isDisabled}
                          title={
                            isDisabled
                              ? "This popup already has a Patron product"
                              : undefined
                          }
                        >
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
          <form.Subscribe selector={(state) => state.values.category}>
            {(category) =>
              category !== "patreon" && (
                <>
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
                    name="compare_price"
                    validators={{
                      onBlur: ({ value, fieldApi }) => {
                        if (readOnly || !value) return undefined
                        const num = Number(value)
                        if (Number.isNaN(num) || num < 0) {
                          return "Compare-at price must be a positive number."
                        }
                        const rawPrice = fieldApi.form.getFieldValue("price")
                        if (rawPrice) {
                          const price = Number(rawPrice)
                          if (!Number.isNaN(price) && num <= price) {
                            return "Compare-at price must be higher than price."
                          }
                        }
                        return undefined
                      },
                    }}
                  >
                    {(field) => (
                      <div>
                        <InlineRow
                          icon={
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                          }
                          label="Compare-at price"
                          description="Crossed-out original price shown next to the current price. Leave empty for no discount."
                        >
                          <Input
                            placeholder="120.00"
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
                </>
              )
            }
          </form.Subscribe>

          <form.Field
            name="total_stock_cap"
            validators={{
              onBlur: ({ value }) => {
                if (readOnly || !value) return undefined
                const num = Number.parseInt(value, 10)
                if (Number.isNaN(num) || num < 1) {
                  return "Total stock must be a positive number. Leave empty for unlimited."
                }
                return undefined
              },
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                  label="Total stock"
                  description="Maximum units available. Leave empty for unlimited."
                >
                  <Input
                    id="total_stock_cap"
                    aria-label="Total stock"
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

          <form.Field
            name="max_per_order"
            validators={{
              onBlur: ({ value, fieldApi }) => {
                if (readOnly || !value) return undefined
                const num = Number.parseInt(value, 10)
                if (Number.isNaN(num) || num < 1) {
                  return "Max per order must be a positive number. Leave empty for unlimited."
                }
                const rawCap = fieldApi.form.getFieldValue("total_stock_cap")
                if (rawCap) {
                  const cap = Number.parseInt(rawCap, 10)
                  if (!Number.isNaN(cap) && num > cap) {
                    return `Cannot exceed total stock cap (${cap})`
                  }
                }
                return undefined
              },
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                  label="Max per order"
                  description="Per-cart cap. Leave empty for unlimited."
                >
                  <Input
                    id="max_per_order"
                    aria-label="Max per order"
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

          <form.Field name="requires_check_in">
            {(field) => (
              <InlineRow
                icon={<QrCode className="h-4 w-4 text-muted-foreground" />}
                label="Requires Check-in"
                description="Enable for products that need scanning at the venue"
              >
                <Switch
                  id="requires_check_in"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                  disabled={readOnly}
                />
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

                  <form.Field name="sale_starts_at">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Sale Starts At"
                        description="When the ticket goes on sale"
                      >
                        <DatePicker
                          value={field.state.value}
                          onChange={(v) => field.handleChange(v)}
                          disabled={readOnly}
                          className="max-w-52"
                          placeholder="Sale start date"
                        />
                      </InlineRow>
                    )}
                  </form.Field>

                  <form.Field name="sale_ends_at">
                    {(field) => (
                      <InlineRow
                        icon={
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        }
                        label="Sale Ends At"
                        description="When the ticket stops being sold"
                      >
                        <DatePicker
                          value={field.state.value}
                          onChange={(v) => field.handleChange(v)}
                          disabled={readOnly}
                          className="max-w-52"
                          placeholder="Sale end date"
                        />
                      </InlineRow>
                    )}
                  </form.Field>
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
