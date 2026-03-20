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
import { cn } from "@/lib/utils"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { DISPLAY_VARIANT_DEFINITIONS } from "./constants"

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
}

export function AddStepDialog({ open, onOpenChange, popupId, nextOrder }: AddStepDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [title, setTitle] = useState("")
  const [stepType, setStepType] = useState("")
  const [stepTypeEdited, setStepTypeEdited] = useState(false)
  const [productCategory, setProductCategory] = useState("")
  const [categoryInput, setCategoryInput] = useState("")
  const [displayVariant, setDisplayVariant] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)

  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", popupId],
    queryFn: () => ProductsService.listProductCategories({ popupId }),
    enabled: !!popupId && open,
  })

  const filteredSuggestions = (categorySuggestions ?? []).filter(
    (c) => c.toLowerCase().includes(categoryInput.toLowerCase()) && c !== categoryInput
  )

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (!stepTypeEdited) {
      setStepType(toKebabCase(value))
    }
  }

  const reset = () => {
    setTitle("")
    setStepType("")
    setStepTypeEdited(false)
    setProductCategory("")
    setCategoryInput("")
    setDisplayVariant("")
  }

  const createMutation = useMutation({
    mutationFn: () =>
      TicketingStepsService.createTicketingStep({
        requestBody: {
          popup_id: popupId,
          step_type: stepType,
          title,
          order: nextOrder,
          is_enabled: true,
          product_category: productCategory || null,
          display_variant: displayVariant || null,
        },
      }),
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
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Step</DialogTitle>
          <DialogDescription>Create a new custom checkout step</DialogDescription>
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
            <Label htmlFor="add-step-type">Step Type (slug)</Label>
            <Input
              id="add-step-type"
              value={stepType}
              onChange={(e) => { setStepType(e.target.value); setStepTypeEdited(true) }}
              placeholder="e.g. ticket-fly"
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier. Auto-generated from title.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-product-category">Product Category</Label>
            <div className="relative">
              <Input
                id="add-product-category"
                value={categoryInput}
                onChange={(e) => {
                  setCategoryInput(e.target.value)
                  setProductCategory(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. ticket-fly"
              />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                  {filteredSuggestions.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onMouseDown={() => {
                        setCategoryInput(cat)
                        setProductCategory(cat)
                        setShowSuggestions(false)
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Products with this category will appear in this step.
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
            <Button variant="outline" onClick={() => { onOpenChange(false); reset() }}>
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
