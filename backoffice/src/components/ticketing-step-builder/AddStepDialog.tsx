import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useState } from "react"

import { ProductsService, TicketingStepsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import { TEMPLATE_DEFINITIONS } from "./constants"

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

interface AddStepDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  popupId: string
  nextOrder: number
  confirmStepId?: string
}

export function AddStepDialog({
  open,
  onOpenChange,
  popupId,
  nextOrder,
  confirmStepId,
}: AddStepDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [title, setTitle] = useState("")
  const [stepType, setStepType] = useState("")
  const [productCategory, setProductCategory] = useState("")
  const [template, setTemplate] = useState("")

  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", popupId],
    queryFn: () => ProductsService.listProductCategories({ popupId }),
    enabled: !!popupId && open,
  })

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setStepType(
      toKebabCase((productCategory ? `${productCategory}-` : "") + value),
    )
  }

  const reset = () => {
    setTitle("")
    setStepType("")
    setProductCategory("")
    setTemplate("")
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      // Insert before confirm: use confirmStep's current order, then bump confirm
      const insertOrder = confirmStepId ? nextOrder - 1 : nextOrder
      await TicketingStepsService.createTicketingStep({
        requestBody: {
          popup_id: popupId,
          step_type: stepType,
          title,
          order: insertOrder,
          is_enabled: true,
          product_category: productCategory || null,
          template: template || null,
        },
      })
      // Push confirm step to the end
      if (confirmStepId) {
        await TicketingStepsService.updateTicketingStep({
          stepId: confirmStepId,
          requestBody: { order: nextOrder },
        })
      }
    },
    onSuccess: () => {
      showSuccessToast("Step created")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      onOpenChange(false)
      reset()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const canSubmit = title.trim().length > 0 && stepType.trim().length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Step</DialogTitle>
          <DialogDescription>
            Create a new custom checkout step
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-title">Title</Label>
            <Input
              id="add-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="e.g. Ticket Fly"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-product-category">Product Category</Label>
            <Select
              value={productCategory}
              onValueChange={(val) => {
                setProductCategory(val)
                setStepType(toKebabCase((val ? `${val}-` : "") + title))
              }}
            >
              <SelectTrigger id="add-product-category">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {productCategory &&
                  !(categorySuggestions ?? []).includes(productCategory) && (
                    <SelectItem value={productCategory}>
                      {productCategory}
                    </SelectItem>
                  )}
                {(categorySuggestions ?? []).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Products with this category will appear in this step.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATE_DEFINITIONS.map((variant) => {
                const Icon = variant.icon
                const isSelected = template === variant.key
                return (
                  <button
                    key={variant.key}
                    type="button"
                    onClick={() => setTemplate(isSelected ? "" : variant.key)}
                    className={cn(
                      "relative flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50 hover:bg-accent/50",
                    )}
                  >
                    {isSelected && (
                      <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
                    )}
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium leading-tight">
                      {variant.label}
                    </span>
                    <span className="text-xs text-muted-foreground leading-tight">
                      {variant.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                reset()
              }}
            >
              Cancel
            </Button>
            <LoadingButton
              loading={createMutation.isPending}
              disabled={!canSubmit}
              onClick={() => createMutation.mutate()}
            >
              Create Step
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
