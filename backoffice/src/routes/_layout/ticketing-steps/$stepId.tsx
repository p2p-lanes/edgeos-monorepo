import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, Trash2 } from "lucide-react"
import { Suspense, useEffect, useRef, useState } from "react"

import { type ApiError, ProductsService, TicketingStepsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import {
  CONTENT_ONLY_TEMPLATES,
  TEMPLATE_DEFINITIONS,
} from "@/components/ticketing-step-builder/constants"
import { TEMPLATE_CONFIG_REGISTRY } from "@/components/ticketing-step-builder/template-configs"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useDirtyBlocker,
} from "@/hooks/useUnsavedChanges"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/ticketing-steps/$stepId")({
  component: StepConfigPage,
  head: () => ({
    meta: [{ title: "Step Settings - EdgeOS" }],
  }),
})

function getStepQueryOptions(stepId: string) {
  return {
    queryKey: ["ticketing-steps", "detail", stepId],
    queryFn: () => TicketingStepsService.getTicketingStep({ stepId }),
  }
}

function StepConfigPage() {
  const { stepId } = Route.useParams()

  return (
    <FormPageLayout
      title="Step Settings"
      description="Configure this checkout step"
      backTo="/ticketing-steps"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <StepConfigContent stepId={stepId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}

function StepConfigContent({ stepId }: { stepId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: step } = useSuspenseQuery(getStepQueryOptions(stepId))
  const isSubmittingRef = useRef(false)

  // Fetch insurance step for confirm step type
  const { data: stepsData } = useQuery({
    queryKey: ["ticketing-steps", step.popup_id],
    queryFn: () =>
      TicketingStepsService.listTicketingSteps({
        popupId: step.popup_id,
        limit: 100,
      }),
    enabled: step.step_type === "confirm",
  })
  const insuranceStep = stepsData?.results?.find(
    (s) => s.step_type === "insurance_checkout",
  )

  // Form state
  const [title, setTitle] = useState(step.title)
  const [description, setDescription] = useState(step.description ?? "")
  const [watermark, setWatermark] = useState(step.watermark ?? "")
  const [productCategory, setProductCategory] = useState(
    step.product_category ?? "",
  )
  const [template, setTemplate] = useState(step.template ?? "")
  const [templateConfig, setTemplateConfig] = useState<Record<
    string,
    unknown
  > | null>((step.template_config as Record<string, unknown>) ?? null)
  const [showTitle, setShowTitle] = useState(step.show_title ?? true)
  const [showWatermark, setShowWatermark] = useState(
    step.show_watermark ?? true,
  )
  const [insuranceEnabled, setInsuranceEnabled] = useState(
    insuranceStep?.is_enabled ?? false,
  )

  const isDirty =
    title !== step.title ||
    description !== (step.description ?? "") ||
    watermark !== (step.watermark ?? "") ||
    productCategory !== (step.product_category ?? "") ||
    template !== (step.template ?? "") ||
    JSON.stringify(templateConfig) !==
      JSON.stringify(step.template_config ?? null) ||
    showTitle !== (step.show_title ?? true) ||
    showWatermark !== (step.show_watermark ?? true) ||
    (!!insuranceStep && insuranceEnabled !== insuranceStep.is_enabled)

  const blocker = useDirtyBlocker(
    isDirty,
    () => isDirty && !isSubmittingRef.current,
  )

  // Sync on step change
  useEffect(() => {
    setTitle(step.title)
    setDescription(step.description ?? "")
    setWatermark(step.watermark ?? "")
    setProductCategory(step.product_category ?? "")
    setTemplate(step.template ?? "")
    setTemplateConfig((step.template_config as Record<string, unknown>) ?? null)
    setShowTitle(step.show_title ?? true)
    setShowWatermark(step.show_watermark ?? true)
  }, [
    step.title,
    step.description,
    step.watermark,
    step.product_category,
    step.template,
    step.template_config,
    step.show_title,
    step.show_watermark,
  ])

  useEffect(() => {
    setInsuranceEnabled(insuranceStep?.is_enabled ?? false)
  }, [insuranceStep?.is_enabled])

  // Product categories for select
  const { data: categorySuggestions } = useQuery({
    queryKey: ["product-categories", step.popup_id],
    queryFn: () =>
      ProductsService.listProductCategories({ popupId: step.popup_id }),
    enabled: !!step.popup_id,
  })

  useEffect(() => {
    if (!productCategory || !categorySuggestions) return
    const match = categorySuggestions.find(
      (c) => c.toLowerCase() === productCategory.toLowerCase(),
    )
    if (match && match !== productCategory) {
      setProductCategory(match)
    }
  }, [categorySuggestions, productCategory])

  // Save mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      await TicketingStepsService.updateTicketingStep({
        stepId: step.id,
        requestBody: {
          title,
          description: description || null,
          watermark: watermark || null,
          product_category: productCategory || null,
          template: template || null,
          template_config: templateConfig,
          show_title: showTitle,
          show_watermark: showWatermark,
        },
      })
      if (insuranceStep && insuranceEnabled !== insuranceStep.is_enabled) {
        await TicketingStepsService.updateTicketingStep({
          stepId: insuranceStep.id,
          requestBody: { is_enabled: insuranceEnabled },
        })
      }
    },
    onMutate: () => {
      isSubmittingRef.current = true
    },
    onSuccess: () => {
      showSuccessToast("Step updated")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      navigate({ to: "/ticketing-steps" })
    },
    onError: (error: Error) => {
      isSubmittingRef.current = false
      createErrorHandler(showErrorToast)(error as ApiError)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () =>
      TicketingStepsService.deleteTicketingStep({ stepId: step.id }),
    onMutate: () => {
      isSubmittingRef.current = true
    },
    onSuccess: () => {
      showSuccessToast("Step deleted")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      navigate({ to: "/ticketing-steps" })
    },
    onError: (error: Error) => {
      isSubmittingRef.current = false
      createErrorHandler(showErrorToast)(error as ApiError)
    },
  })

  // Template config component
  const TemplateConfigComponent = template
    ? TEMPLATE_CONFIG_REGISTRY[template]
    : undefined

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">General</CardTitle>
          <CardDescription>Basic step configuration</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
            <Label htmlFor="step-watermark">Watermark Text</Label>
            <Input
              id="step-watermark"
              value={watermark}
              onChange={(e) => setWatermark(e.target.value)}
              placeholder="Short text shown as background watermark (e.g., Passes)"
            />
            <p className="text-xs text-muted-foreground">
              Large decorative text shown behind the section header in snap
              layout.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label>Show Title</Label>
              <p className="text-xs text-muted-foreground">
                Display the section title in the checkout
              </p>
            </div>
            <Switch
              checked={showTitle}
              onCheckedChange={setShowTitle}
              aria-label="Toggle title visibility"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label>Show Watermark</Label>
              <p className="text-xs text-muted-foreground">
                Display the decorative watermark text behind the header
              </p>
            </div>
            <Switch
              checked={showWatermark}
              onCheckedChange={setShowWatermark}
              aria-label="Toggle watermark visibility"
            />
          </div>

          {!CONTENT_ONLY_TEMPLATES.has(template) &&
            step.step_type !== "confirm" && (
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
                    {productCategory &&
                      !(categorySuggestions ?? []).includes(
                        productCategory,
                      ) && (
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
                  Which product category this step displays. Must match a
                  product's category field.
                </p>
              </div>
            )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-footer">Footer Note</Label>
            <Textarea
              id="step-footer"
              value={(templateConfig?.footer_text as string) ?? ""}
              onChange={(e) =>
                setTemplateConfig({
                  ...templateConfig,
                  footer_text: e.target.value || undefined,
                })
              }
              placeholder="Optional note shown below this step's content (e.g., pricing clarifications, terms)"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Small text displayed at the bottom of this section in the
              checkout.
            </p>
          </div>

          {step.step_type === "confirm" && insuranceStep && (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex flex-col gap-0.5">
                <Label>Enable Insurance</Label>
                <p className="text-xs text-muted-foreground">
                  Show the insurance card on the Review &amp; Confirm page
                </p>
              </div>
              <Switch
                checked={insuranceEnabled}
                onCheckedChange={setInsuranceEnabled}
                aria-label="Toggle insurance"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template Selection & Configuration (hidden for confirm step) */}
      {step.step_type !== "confirm" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Template</CardTitle>
              <CardDescription>
                Choose how products are displayed in the checkout
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATE_DEFINITIONS.map((def) => {
                  const Icon = def.icon
                  const isSelected = template === def.key
                  return (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => {
                        setTemplate(isSelected ? "" : def.key)
                        if (isSelected) setTemplateConfig(null)
                      }}
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
                        {def.label}
                      </span>
                      <span className="text-xs text-muted-foreground leading-tight">
                        {def.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {TemplateConfigComponent && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Template Configuration
                </CardTitle>
                <CardDescription>
                  Settings specific to the{" "}
                  {TEMPLATE_DEFINITIONS.find((d) => d.key === template)?.label}{" "}
                  template
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TemplateConfigComponent
                  config={templateConfig}
                  onChange={setTemplateConfig}
                  popupId={step.popup_id}
                  productCategory={productCategory || null}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Actions */}
      <Separator />
      <div className="flex items-center gap-2">
        {!step.protected && (
          <LoadingButton
            variant="destructive"
            size="icon"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            className="h-9 w-9 shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </LoadingButton>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/ticketing-steps" })}
        >
          Cancel
        </Button>
        <LoadingButton
          loading={updateMutation.isPending}
          onClick={() => updateMutation.mutate()}
        >
          Save
        </LoadingButton>
      </div>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
