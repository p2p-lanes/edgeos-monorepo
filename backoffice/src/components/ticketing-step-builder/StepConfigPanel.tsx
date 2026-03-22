import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"

import { type TicketingStepPublic, ProductsService, TicketingStepsService } from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { DISPLAY_VARIANT_DEFINITIONS } from "./constants"

interface StepConfigPanelProps {
  step: TicketingStepPublic
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
}

export function StepConfigPanel({ step, open, onOpenChange, onClose }: StepConfigPanelProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [title, setTitle] = useState(step.title)
  const [description, setDescription] = useState(step.description ?? "")
  const [productCategory, setProductCategory] = useState(step.product_category ?? "")
  const [displayVariant, setDisplayVariant] = useState(step.display_variant ?? "")

  useEffect(() => {
    setTitle(step.title)
    setDescription(step.description ?? "")
    setProductCategory(step.product_category ?? "")
    setDisplayVariant(step.display_variant ?? "")
  }, [step.id, step.title, step.description, step.product_category, step.display_variant])

  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", step.popup_id],
    queryFn: () => ProductsService.listProductCategories({ popupId: step.popup_id }),
    enabled: !!step.popup_id,
  })

  useEffect(() => {
    if (!productCategory || !categorySuggestions) return
    const match = categorySuggestions.find(
      (c) => c.toLowerCase() === productCategory.toLowerCase()
    )
    if (match && match !== productCategory) {
      setProductCategory(match)
    }
  }, [categorySuggestions])

  const updateMutation = useMutation({
    mutationFn: () =>
      TicketingStepsService.updateTicketingStep({
        stepId: step.id,
        requestBody: {
          title,
          description: description || null,
          product_category: productCategory || null,
          display_variant: displayVariant || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Step updated")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      onClose()
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Step Settings</DialogTitle>
          <DialogDescription>Configure this checkout step</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-title">Title</Label>
            <Input
              id="step-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-description">Description</Label>
            <Textarea
              id="step-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description shown to customers"
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-product-category">Product Category</Label>
            <Select
              value={productCategory}
              onValueChange={(val) => setProductCategory(val)}
            >
              <SelectTrigger id="step-product-category">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {productCategory && !(categorySuggestions ?? []).includes(productCategory) && (
                  <SelectItem value={productCategory}>{productCategory}</SelectItem>
                )}
                {(categorySuggestions ?? []).map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Which product category this step displays. Must match a product's category field.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Display Variant</Label>
            <div className="grid grid-cols-2 gap-2">
              {DISPLAY_VARIANT_DEFINITIONS.map((variant) => {
                const Icon = variant.icon
                const isSelected = displayVariant === variant.key
                return (
                  <button
                    key={variant.key}
                    type="button"
                    onClick={() => setDisplayVariant(isSelected ? "" : variant.key)}
                    className={cn(
                      "relative flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50 hover:bg-accent/50"
                    )}
                  >
                    {isSelected && (
                      <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
                    )}
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium leading-tight">{variant.label}</span>
                    <span className="text-xs text-muted-foreground leading-tight">{variant.description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton
              loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              Save
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
