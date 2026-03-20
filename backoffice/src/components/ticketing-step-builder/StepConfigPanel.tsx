"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"

import { type TicketingStepPublic, ProductsService, TicketingStepsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { DISPLAY_VARIANT_DEFINITIONS } from "./constants"

interface StepConfigPanelProps {
  step: TicketingStepPublic
  onClose: () => void
}

export function StepConfigPanel({ step, onClose }: StepConfigPanelProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [title, setTitle] = useState(step.title)
  const [description, setDescription] = useState(step.description ?? "")
  const [productCategory, setProductCategory] = useState(step.product_category ?? "")
  const [displayVariant, setDisplayVariant] = useState(step.display_variant ?? "")
  const [categoryInput, setCategoryInput] = useState(step.product_category ?? "")
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    setTitle(step.title)
    setDescription(step.description ?? "")
    setProductCategory(step.product_category ?? "")
    setDisplayVariant(step.display_variant ?? "")
    setCategoryInput(step.product_category ?? "")
  }, [step.id, step.title, step.description, step.product_category, step.display_variant])

  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", step.popup_id],
    queryFn: () => ProductsService.listProductCategories({ popupId: step.popup_id }),
    enabled: !!step.popup_id,
  })

  const filteredSuggestions = (categorySuggestions ?? []).filter(
    (c) => c.toLowerCase().includes(categoryInput.toLowerCase()) && c !== categoryInput
  )

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
    <SheetContent className="sm:max-w-md overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Step Settings</SheetTitle>
        <SheetDescription>Configure this checkout step</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 mt-6">
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
          <div className="relative">
            <Input
              id="step-product-category"
              value={categoryInput}
              onChange={(e) => {
                setCategoryInput(e.target.value)
                setProductCategory(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="e.g. ticket, housing, ticket-fly"
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
    </SheetContent>
  )
}
