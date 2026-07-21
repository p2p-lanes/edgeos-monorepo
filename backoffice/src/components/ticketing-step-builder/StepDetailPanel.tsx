import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { Suspense, useEffect, useRef, useState } from "react"

import {
  type ApiError,
  PopupsService,
  ProductsService,
  TicketingStepsService,
} from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { CollapsibleSection } from "@/components/ticketing-step-builder/step-detail/CollapsibleSection"
import { ConfirmStepFields } from "@/components/ticketing-step-builder/step-detail/ConfirmStepFields"
import { StepContentSection } from "@/components/ticketing-step-builder/step-detail/StepContentSection"
import { StepDisplaySettings } from "@/components/ticketing-step-builder/step-detail/StepDisplaySettings"
import { StepIdentityHeader } from "@/components/ticketing-step-builder/step-detail/StepIdentityHeader"
import {
  buildFaqsValue,
  type FaqItem,
  FaqItemsEditor,
  parseFaqItems,
} from "@/components/ticketing-step-builder/template-configs/FaqItemsEditor"
import { TranslationManager } from "@/components/translations/TranslationManager"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useDirtyBlocker,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface StepDetailPanelProps {
  stepId: string
  onClose: () => void
}

function getStepQueryOptions(stepId: string) {
  return {
    queryKey: ["ticketing-steps", "detail", stepId],
    queryFn: () => TicketingStepsService.getTicketingStep({ stepId }),
  }
}

export function StepDetailPanel({ stepId, onClose }: StepDetailPanelProps) {
  return (
    <QueryErrorBoundary>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <StepDetailContent stepId={stepId} onClose={onClose} />
      </Suspense>
    </QueryErrorBoundary>
  )
}

function StepDetailContent({ stepId, onClose }: StepDetailPanelProps) {
  const queryClient = useQueryClient()
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
      isSubmittingRef.current = false
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
      onClose()
    },
    onError: (error: Error) => {
      isSubmittingRef.current = false
      createErrorHandler(showErrorToast)(error as ApiError)
    },
  })

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
          {/* Identity */}
          <StepIdentityHeader
            stepType={step.step_type}
            emoji={emoji}
            onEmojiChange={setEmoji}
            title={title}
            onTitleChange={setTitle}
            template={template}
          />

          {/* Content (primary): the actual thing the operator came to edit */}
          {step.step_type === "confirm" ? (
            <ConfirmStepFields
              popupId={step.popup_id}
              insuranceEnabled={!!popup?.insurance_enabled}
              templateConfig={templateConfig}
              onTemplateConfigChange={setTemplateConfig}
            />
          ) : step.step_type === "buyer" ? null : (
            <StepContentSection
              popupId={step.popup_id}
              template={template}
              onTemplateChange={(key) => {
                setTemplate(key)
                if (!key) setTemplateConfig(null)
              }}
              templateConfig={templateConfig}
              onTemplateConfigChange={setTemplateConfig}
              productCategory={productCategory}
            />
          )}

          {/* Display & advanced */}
          <StepDisplaySettings
            stepType={step.step_type}
            template={template}
            description={description}
            onDescriptionChange={setDescription}
            watermark={watermark}
            onWatermarkChange={setWatermark}
            showTitle={showTitle}
            onShowTitleChange={setShowTitle}
            showWatermark={showWatermark}
            onShowWatermarkChange={setShowWatermark}
            showInNavbar={showInNavbar}
            onShowInNavbarChange={setShowInNavbar}
            productCategory={productCategory}
            onProductCategoryChange={setProductCategory}
            categorySuggestions={categorySuggestions}
            footerText={(templateConfig?.footer_text as string) ?? ""}
            onFooterTextChange={(value) =>
              setTemplateConfig({
                ...templateConfig,
                footer_text: value || undefined,
              })
            }
          />

          {/* This step's own FAQs, shown below its content. Hidden on the
              `faqs` template, whose whole purpose is already a question list —
              a step there would carry two. */}
          {template !== "faqs" && (
            <CollapsibleSection
              title="FAQs"
              description="Questions shown below this step's content. Rendered only on the Amanita checkout skin."
            >
              <FaqItemsEditor
                title={stepFaqsTitle}
                items={stepFaqItems}
                titleDescription="Heading shown above the questions. Leave empty for none."
                onChangeTitle={(next) => setStepFaqs(next, stepFaqItems)}
                onChangeItems={(next) => setStepFaqs(stepFaqsTitle, next)}
              />
            </CollapsibleSection>
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
