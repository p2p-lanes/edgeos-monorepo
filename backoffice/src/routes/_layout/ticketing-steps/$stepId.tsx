import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Info, Trash2 } from "lucide-react"
import { Suspense, useEffect, useRef, useState } from "react"

import {
  type ApiError,
  PopupsService,
  ProductsService,
  TicketingStepsService,
} from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import {
  CONTENT_ONLY_TEMPLATES,
  getStepTypeDefinition,
  TEMPLATE_DEFINITIONS,
} from "@/components/ticketing-step-builder/constants"
import { TEMPLATE_CONFIG_REGISTRY } from "@/components/ticketing-step-builder/template-configs"
import {
  buildFaqsValue,
  type FaqItem,
  FaqItemsEditor,
  parseFaqItems,
} from "@/components/ticketing-step-builder/template-configs/FaqItemsEditor"
import { TranslationManager } from "@/components/translations/TranslationManager"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"
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
  const goBack = useGoBack({ to: "/ticketing-steps" })
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: step } = useSuspenseQuery(getStepQueryOptions(stepId))
  const isSubmittingRef = useRef(false)

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
  const [showInNavbar, setShowInNavbar] = useState(step.show_in_navbar ?? true)
  const [emoji, setEmoji] = useState(step.emoji ?? "")

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
    showInNavbar !== (step.show_in_navbar ?? true) ||
    emoji !== (step.emoji ?? "")

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
    setShowInNavbar(step.show_in_navbar ?? true)
    setEmoji(step.emoji ?? "")
  }, [
    step.title,
    step.description,
    step.watermark,
    step.product_category,
    step.template,
    step.template_config,
    step.show_title,
    step.show_watermark,
    step.show_in_navbar,
    step.emoji,
  ])

  // Popup data: needed for the insurance_enabled gate on the confirm step and
  // for the supported/default languages that drive the translations editor.
  const { data: popup } = useQuery({
    queryKey: ["popups", "detail", step.popup_id],
    queryFn: () => PopupsService.getPopup({ popupId: step.popup_id }),
    enabled: !!step.popup_id,
  })

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
          show_in_navbar: showInNavbar,
          emoji: emoji.trim() || null,
        },
      })
    },
    onMutate: () => {
      isSubmittingRef.current = true
    },
    onSuccess: () => {
      showSuccessToast("Step updated")
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
      goBack()
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
      goBack()
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

  // This step's own FAQs, stored under `template_config.faqs` — nested rather
  // than at the top level so they can't collide with the `faqs` template's own
  // `items`, which feed the global drawer.
  const stepFaqs = (templateConfig?.faqs ?? null) as Record<
    string,
    unknown
  > | null
  const stepFaqsTitle = (stepFaqs?.title as string) ?? ""
  const stepFaqItems = parseFaqItems(stepFaqs?.items)

  const setStepFaqs = (title: string, items: FaqItem[]) => {
    setTemplateConfig({
      ...templateConfig,
      faqs: buildFaqsValue(title, items),
    })
  }

  const hasTranslations = (popup?.supported_languages?.length ?? 0) > 1

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <Tabs defaultValue="general" className="flex flex-col gap-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="translations">Translations</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="flex flex-col gap-6">
          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">General</CardTitle>
              <CardDescription>Basic step configuration</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="step-title">Title</Label>
                <div className="flex gap-1.5">
                  <div className="relative w-16">
                    <Input
                      id="step-emoji"
                      aria-label="Step emoji"
                      value={emoji}
                      onChange={(e) => setEmoji(e.target.value.slice(0, 8))}
                      className="w-full text-center text-lg"
                    />
                    {/* When the operator hasn't picked a custom emoji, render the
                    step-type's resolved default icon inside the input so the
                    preview matches what the checkout nav will actually show.
                    Replaces the legacy hardcoded "🎟️" placeholder which made
                    every step look like Tickets by default. */}
                    {!emoji &&
                      (() => {
                        const DefaultIcon = getStepTypeDefinition(
                          step.step_type,
                        )?.icon
                        return DefaultIcon ? (
                          <DefaultIcon
                            className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground pointer-events-none"
                            aria-hidden="true"
                          />
                        ) : null
                      })()}
                  </div>
                  <Input
                    id="step-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional emoji replaces the default icon in the checkout step
                  nav. Leave blank to keep the built-in icon (shown faded
                  above).
                </p>
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

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex flex-col gap-0.5">
                  <Label>Show in Navbar</Label>
                  <p className="text-xs text-muted-foreground">
                    Whether the step appears in the top section nav. Hidden
                    steps still render and are reachable by scroll — useful for
                    informational sections that shouldn't clutter the nav.
                  </p>
                </div>
                <Switch
                  checked={showInNavbar}
                  onCheckedChange={setShowInNavbar}
                  aria-label="Toggle navbar visibility"
                />
              </div>

              {!CONTENT_ONLY_TEMPLATES.has(template) &&
                step.step_type !== "confirm" &&
                step.step_type !== "buyer" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="step-product-category">
                      Product Category
                    </Label>
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
            </CardContent>
          </Card>

          {/* This step's own FAQs, shown below its content. Hidden on the
              `faqs` template, whose whole purpose is already a question list —
              a step there would carry two. */}
          {template !== "faqs" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">FAQs</CardTitle>
                <CardDescription>
                  Questions shown below this step's content. Rendered only on
                  the Amanita checkout skin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FaqItemsEditor
                  title={stepFaqsTitle}
                  items={stepFaqItems}
                  titleDescription="Heading shown above the questions. Leave empty for none."
                  onChangeTitle={(next) => setStepFaqs(next, stepFaqItems)}
                  onChangeItems={(next) => setStepFaqs(stepFaqsTitle, next)}
                />
              </CardContent>
            </Card>
          )}

          {/* Pay button label (only for confirm step) */}
          {step.step_type === "confirm" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pay Button</CardTitle>
                <CardDescription>
                  The button that completes the purchase
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-cta-label">Button Label</Label>
                  <Input
                    id="confirm-cta-label"
                    value={(templateConfig?.cta_label as string) ?? ""}
                    onChange={(e) =>
                      setTemplateConfig({
                        ...templateConfig,
                        cta_label: e.target.value || undefined,
                      })
                    }
                    placeholder="Pagar"
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown on both the bottom bar's button and the one inside the
                    confirm card — they always read the same. Leave empty to use
                    the checkout's own wording, translated per shopper. Once
                    set, translate it in this step's Translations tab.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Insurance Card Content (only for confirm step) */}
          {step.step_type === "confirm" &&
            (popup?.insurance_enabled ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Insurance Card</CardTitle>
                  <CardDescription>
                    Text displayed inside the insurance toggle card in this step
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="insurance-card-title">Card Title</Label>
                    <Input
                      id="insurance-card-title"
                      value={
                        ((templateConfig?.insurance as Record<string, unknown>)
                          ?.card_title as string) ?? ""
                      }
                      onChange={(e) =>
                        setTemplateConfig({
                          ...templateConfig,
                          insurance: {
                            ...(templateConfig?.insurance as Record<
                              string,
                              unknown
                            >),
                            card_title: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="Insurance"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="insurance-card-subtitle">
                      Card Subtitle
                    </Label>
                    <Input
                      id="insurance-card-subtitle"
                      value={
                        ((templateConfig?.insurance as Record<string, unknown>)
                          ?.card_subtitle as string) ?? ""
                      }
                      onChange={(e) =>
                        setTemplateConfig({
                          ...templateConfig,
                          insurance: {
                            ...(templateConfig?.insurance as Record<
                              string,
                              unknown
                            >),
                            card_subtitle: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="Change of plans coverage"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="insurance-toggle-label">Toggle Label</Label>
                    <Input
                      id="insurance-toggle-label"
                      value={
                        ((templateConfig?.insurance as Record<string, unknown>)
                          ?.toggle_label as string) ?? ""
                      }
                      onChange={(e) =>
                        setTemplateConfig({
                          ...templateConfig,
                          insurance: {
                            ...(templateConfig?.insurance as Record<
                              string,
                              unknown
                            >),
                            toggle_label: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="Add insurance"
                    />
                    <p className="text-xs text-muted-foreground">
                      Accessible label for the insurance toggle button.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="insurance-benefits">
                      Benefits (one per line)
                    </Label>
                    <Textarea
                      id="insurance-benefits"
                      value={
                        Array.isArray(
                          (templateConfig?.insurance as Record<string, unknown>)
                            ?.benefits,
                        )
                          ? (
                              (
                                templateConfig?.insurance as Record<
                                  string,
                                  unknown
                                >
                              )?.benefits as string[]
                            ).join("\n")
                          : ""
                      }
                      onChange={(e) =>
                        setTemplateConfig({
                          ...templateConfig,
                          insurance: {
                            ...(templateConfig?.insurance as Record<
                              string,
                              unknown
                            >),
                            benefits: e.target.value
                              ? e.target.value
                                  .split("\n")
                                  .map((l) => l.trim())
                                  .filter(Boolean)
                              : [],
                          },
                        })
                      }
                      placeholder={
                        "Full refund up to 14 days before the event\n50% refund up to 7 days before\nFree date change at no extra cost"
                      }
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Each line becomes a benefit bullet in the card.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Enable insurance in gathering settings to configure the card
                  content.{" "}
                  <Link
                    to="/popups/$id/edit"
                    params={{ id: step.popup_id }}
                    className="underline font-medium"
                  >
                    Go to Gathering Settings
                  </Link>
                </AlertDescription>
              </Alert>
            ))}

          {/* Template Selection & Configuration (hidden for the steps whose
              template is not a choice: confirm, and buyer — the checkout
              renders both by step_type, so swapping their template would only
              produce a step that no longer draws itself.) */}
          {step.step_type !== "confirm" && step.step_type !== "buyer" && (
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
                      {
                        TEMPLATE_DEFINITIONS.find((d) => d.key === template)
                          ?.label
                      }{" "}
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
            <Button variant="outline" onClick={goBack}>
              Cancel
            </Button>
            <LoadingButton
              loading={updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              Save
            </LoadingButton>
          </div>
        </TabsContent>

        <TabsContent value="translations" className="flex flex-col gap-4">
          {!hasTranslations ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Enable a second language on the event to translate this step.
            </div>
          ) : isDirty ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Save your changes first to translate the latest content.
            </div>
          ) : (
            <TranslationManager
              entityType="ticketing_step"
              entityId={step.id}
              translatableFields={["title", "description", "watermark"]}
              sourceData={{
                title: step.title,
                description: step.description,
                watermark: step.watermark ?? "",
              }}
              nestedField="template_config"
              nestedSource={step.template_config}
              supportedLanguages={popup!.supported_languages!}
              defaultLanguage={popup!.default_language!}
            />
          )}
        </TabsContent>
      </Tabs>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
