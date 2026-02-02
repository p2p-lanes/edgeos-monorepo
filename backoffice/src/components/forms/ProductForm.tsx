import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { DollarSign, Package, Tag, Ticket } from "lucide-react"

import {
  type ProductCategory,
  type ProductCreate,
  type ProductPublic,
  ProductsService,
  type ProductUpdate,
  type TicketAttendeeCategory,
  type TicketDuration,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface ProductFormProps {
  defaultValues?: ProductPublic
  onSuccess: () => void
}

const PRODUCT_CATEGORIES: {
  value: ProductCategory
  label: string
  icon: typeof Package
}[] = [
  { value: "ticket", label: "Ticket", icon: Ticket },
  { value: "housing", label: "Housing", icon: Package },
  { value: "merch", label: "Merchandise", icon: Tag },
  { value: "other", label: "Other", icon: Package },
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

export function ProductForm({ defaultValues, onSuccess }: ProductFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const createMutation = useMutation({
    mutationFn: (data: ProductCreate) =>
      ProductsService.createProduct({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Product created successfully")
      queryClient.invalidateQueries({ queryKey: ["products"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
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
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      ProductsService.deleteProduct({ productId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Product deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["products"] })
      navigate({ to: "/products" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      price: defaultValues?.price?.toString() ?? "",
      description: defaultValues?.description ?? "",
      category: (defaultValues?.category ?? "ticket") as ProductCategory,
      attendee_category: (defaultValues?.attendee_category ??
        "main") as TicketAttendeeCategory,
      duration_type: (defaultValues?.duration_type ?? "full") as TicketDuration,
      is_active: defaultValues?.is_active ?? true,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return

      const isTicket = value.category === "ticket"

      if (isEdit) {
        updateMutation.mutate({
          name: value.name,
          price: value.price,
          description: value.description || null,
          category: value.category,
          attendee_category: isTicket ? value.attendee_category : null,
          duration_type: isTicket ? value.duration_type : null,
          is_active: value.is_active,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          name: value.name,
          price: value.price,
          description: value.description || undefined,
          category: value.category,
          attendee_category: isTicket ? value.attendee_category : undefined,
          duration_type: isTicket ? value.duration_type : undefined,
          is_active: value.is_active,
        })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Show alert if no popup selected (only for create mode)
  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="product" action="create" />
  }

  const getCategoryInfo = (category: ProductCategory) =>
    PRODUCT_CATEGORIES.find((c) => c.value === category) ||
    PRODUCT_CATEGORIES[0]

  const getDurationLabel = (duration: TicketDuration) =>
    TICKET_DURATIONS.find((d) => d.value === duration)?.label || duration

  const getAttendeeLabel = (category: TicketAttendeeCategory) =>
    ATTENDEE_CATEGORIES.find((c) => c.value === category)?.label || category

  return (
    <div className="space-y-6">
      <form
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
                    ? "Product Details"
                    : isEdit
                      ? "Basic Information"
                      : "Product Details"}
                </CardTitle>
                <CardDescription>
                  {readOnly
                    ? "View product information (read-only)"
                    : isEdit
                      ? "Update the product name, category, and pricing"
                      : "Enter the basic information for the new product"}
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
                        placeholder="General Admission"
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="category">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="category">
                          Category{" "}
                          {!readOnly && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(val) =>
                            field.handleChange(val as ProductCategory)
                          }
                          disabled={readOnly}
                        >
                          <SelectTrigger id="category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {PRODUCT_CATEGORIES.map((cat) => (
                              <SelectItem key={cat.value} value={cat.value}>
                                {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-sm text-muted-foreground">
                          Tickets have additional options
                        </p>
                      </div>
                    )}
                  </form.Field>

                  <form.Field
                    name="price"
                    validators={{
                      onBlur: ({ value }) =>
                        !readOnly && !value ? "Price is required" : undefined,
                    }}
                  >
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="price">
                          Price{" "}
                          {!readOnly && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <Input
                          id="price"
                          placeholder="100.00"
                          type="text"
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
                </div>

                <form.Field name="description">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Input
                        id="description"
                        placeholder="Product description..."
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        Optional description shown to customers
                      </p>
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Ticket Options - Only shown when category is "ticket" */}
            <form.Subscribe selector={(state) => state.values.category}>
              {(category) =>
                category === "ticket" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Ticket Options</CardTitle>
                      <CardDescription>
                        Configure ticket-specific settings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.Field name="duration_type">
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor="duration_type">Duration</Label>
                              <Select
                                value={field.state.value}
                                onValueChange={(val) =>
                                  field.handleChange(val as TicketDuration)
                                }
                                disabled={readOnly}
                              >
                                <SelectTrigger id="duration_type">
                                  <SelectValue placeholder="Select duration" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TICKET_DURATIONS.map((dur) => (
                                    <SelectItem
                                      key={dur.value}
                                      value={dur.value}
                                    >
                                      {dur.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-sm text-muted-foreground">
                                How long the ticket is valid
                              </p>
                            </div>
                          )}
                        </form.Field>

                        <form.Field name="attendee_category">
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor="attendee_category">
                                Attendee Type
                              </Label>
                              <Select
                                value={field.state.value}
                                onValueChange={(val) =>
                                  field.handleChange(
                                    val as TicketAttendeeCategory,
                                  )
                                }
                                disabled={readOnly}
                              >
                                <SelectTrigger id="attendee_category">
                                  <SelectValue placeholder="Select attendee type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ATTENDEE_CATEGORIES.map((cat) => (
                                    <SelectItem
                                      key={cat.value}
                                      value={cat.value}
                                    >
                                      {cat.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-sm text-muted-foreground">
                                Who can purchase this ticket
                              </p>
                            </div>
                          )}
                        </form.Field>
                      </div>
                    </CardContent>
                  </Card>
                )
              }
            </form.Subscribe>

            {/* Status */}
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Control product availability</CardDescription>
              </CardHeader>
              <CardContent>
                <form.Field name="is_active">
                  {(field) => (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="is_active">Active</Label>
                        <p className="text-sm text-muted-foreground">
                          Product is available for purchase
                        </p>
                      </div>
                      <Switch
                        id="is_active"
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
          </div>

          {/* Right Column - Summary/Preview */}
          <div className="space-y-6">
            <form.Subscribe
              selector={(state) => ({
                name: state.values.name,
                price: state.values.price,
                category: state.values.category,
                description: state.values.description,
                is_active: state.values.is_active,
                duration_type: state.values.duration_type,
                attendee_category: state.values.attendee_category,
              })}
            >
              {(values) => {
                const categoryInfo = getCategoryInfo(values.category)
                const CategoryIcon = categoryInfo.icon

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Preview</CardTitle>
                      <CardDescription>
                        How this product will appear
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <CategoryIcon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className="font-medium leading-none">
                            {values.name || "Product Name"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {categoryInfo.label}
                          </p>
                        </div>
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <DollarSign className="h-4 w-4" />
                          <span className="text-sm">Price</span>
                        </div>
                        <span className="font-semibold">
                          ${values.price || "0.00"}
                        </span>
                      </div>

                      {values.description && (
                        <>
                          <Separator />
                          <p className="text-sm text-muted-foreground">
                            {values.description}
                          </p>
                        </>
                      )}

                      {values.category === "ticket" && (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                Duration
                              </span>
                              <span>
                                {getDurationLabel(values.duration_type)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">For</span>
                              <span>
                                {getAttendeeLabel(values.attendee_category)}
                              </span>
                            </div>
                          </div>
                        </>
                      )}

                      <Separator />

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Status
                        </span>
                        <Badge
                          variant={values.is_active ? "default" : "secondary"}
                        >
                          {values.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                )
              }}
            </form.Subscribe>

            {isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Product Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Slug</p>
                    <p className="font-mono text-sm">{defaultValues.slug}</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">Product ID</p>
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

      {isEdit && !readOnly && (
        <DangerZone
          description="Once you delete this product, it will be permanently removed. Existing purchases will not be affected."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Product"
          resourceName={defaultValues.name}
        />
      )}
    </div>
  )
}
