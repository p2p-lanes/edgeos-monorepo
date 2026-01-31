import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface ProductFormProps {
  defaultValues?: ProductPublic
  onSuccess: () => void
}

const PRODUCT_CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: "ticket", label: "Ticket" },
  { value: "housing", label: "Housing" },
  { value: "merch", label: "Merchandise" },
  { value: "other", label: "Other" },
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
          slug: "",
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

  return (
    <div className="space-y-6">
      {isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Product Information</CardTitle>
            <CardDescription>Details about this product</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Slug</Label>
                <p className="font-mono text-sm">{defaultValues.slug}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            {readOnly
              ? "Product Details"
              : isEdit
                ? "Edit Product"
                : "Product Details"}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? "View product information (read-only)"
              : isEdit
                ? "Update the product information"
                : "Enter the information for the new product/ticket"}
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
                    {!readOnly && <span className="text-destructive">*</span>}
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

            <form.Field name="category">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="category">
                    Category{" "}
                    {!readOnly && <span className="text-destructive">*</span>}
                  </Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(val) =>
                      field.handleChange(val as ProductCategory)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger>
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
                    The type of product (tickets have additional options)
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
                    {!readOnly && <span className="text-destructive">*</span>}
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
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.category}>
              {(category) =>
                category === "ticket" && (
                  <>
                    <form.Field name="duration_type">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor="duration_type">Duration Type</Label>
                          <Select
                            value={field.state.value}
                            onValueChange={(val) =>
                              field.handleChange(val as TicketDuration)
                            }
                            disabled={readOnly}
                          >
                            <SelectTrigger>
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
                          <p className="text-sm text-muted-foreground">
                            How long the ticket is valid for
                          </p>
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="attendee_category">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor="attendee_category">
                            Attendee Category
                          </Label>
                          <Select
                            value={field.state.value}
                            onValueChange={(val) =>
                              field.handleChange(val as TicketAttendeeCategory)
                            }
                            disabled={readOnly}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select attendee category" />
                            </SelectTrigger>
                            <SelectContent>
                              {ATTENDEE_CATEGORIES.map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>
                                  {cat.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-sm text-muted-foreground">
                            Which type of attendee can purchase this ticket
                          </p>
                        </div>
                      )}
                    </form.Field>
                  </>
                )
              }
            </form.Subscribe>

            <form.Field name="is_active">
              {(field) => (
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="is_active"
                    checked={field.state.value}
                    onCheckedChange={(val) => field.handleChange(!!val)}
                    disabled={readOnly}
                  />
                  <Label htmlFor="is_active" className="font-normal">
                    Active (available for purchase)
                  </Label>
                </div>
              )}
            </form.Field>

            <div className="flex gap-4 pt-4">
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
        </CardContent>
      </Card>

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
