import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { ProductsService, TicketingStepsService } from "@/client"
import { TemplatePicker } from "@/components/ticketing-step-builder/TemplatePicker"
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
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { CONTENT_ONLY_TEMPLATES, TEMPLATE_DEFINITIONS } from "./constants"

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

interface NewStepPanelProps {
  popupId: string
  nextOrder: number
  confirmStepId?: string
  onCreated: (stepId: string) => void
  onCancel: () => void
}

export function NewStepPanel({
  popupId,
  nextOrder,
  confirmStepId,
  onCreated,
  onCancel,
}: NewStepPanelProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [title, setTitle] = useState("")
  const [stepType, setStepType] = useState("")
  const [productCategory, setProductCategory] = useState("")
  const [template, setTemplate] = useState("")

  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", popupId],
    queryFn: () => ProductsService.listProductCategories({ popupId }),
    enabled: !!popupId,
  })

  // A template may pin the step_type (see TemplateDefinition.stepType). The
  // title-derived type still tracks the input underneath, so clearing the
  // template hands the step back to the normal naming rule.
  const pinnedStepType = TEMPLATE_DEFINITIONS.find(
    (def) => def.key === template,
  )?.stepType
  const effectiveStepType = pinnedStepType ?? stepType

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setStepType(
      toKebabCase((productCategory ? `${productCategory}-` : "") + value),
    )
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      // Insert before confirm: use confirmStep's current order, then bump confirm
      const insertOrder = confirmStepId ? nextOrder - 1 : nextOrder
      const newStep = await TicketingStepsService.createTicketingStep({
        requestBody: {
          popup_id: popupId,
          step_type: effectiveStepType,
          title,
          order: insertOrder,
          is_enabled: true,
          // Send a category only when the picker is on screen: a template
          // that shows no products hides it, and a category chosen before
          // that template was picked would otherwise ride along invisibly.
          product_category: CONTENT_ONLY_TEMPLATES.has(template)
            ? null
            : productCategory || null,
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
      return newStep
    },
    onSuccess: (newStep) => {
      showSuccessToast("Step created")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      onCreated(newStep.id)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const canSubmit =
    title.trim().length > 0 && effectiveStepType.trim().length > 0

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Add Step</CardTitle>
        <CardDescription>Create a new custom checkout step</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-title">Title</Label>
          <Input
            id="add-title"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="e.g. Ticket Fly"
          />
        </div>

        {!CONTENT_ONLY_TEMPLATES.has(template) && (
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
        )}

        <div className="flex flex-col gap-1.5">
          <Label>Template</Label>
          <TemplatePicker value={template} onChange={setTemplate} />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>
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
      </CardContent>
    </Card>
  )
}
