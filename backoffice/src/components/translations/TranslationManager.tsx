import { Save } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTranslationsQuery,
  useUpsertTranslation,
} from "@/hooks/useTranslations"
import { AITranslateButton } from "./AITranslateButton"
import { TranslationFieldEditor } from "./TranslationFieldEditor"

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
}

const MULTILINE_FIELDS = new Set([
  "description",
  "welcome_message",
  "help_text",
])

interface TranslationManagerProps {
  entityType: string
  entityId: string
  translatableFields: string[]
  sourceData: Record<string, string | null | undefined>
  supportedLanguages: string[]
  defaultLanguage?: string
}

export function TranslationManager({
  entityType,
  entityId,
  translatableFields,
  sourceData,
  supportedLanguages,
  defaultLanguage = "en",
}: TranslationManagerProps) {
  const nonDefaultLanguages = supportedLanguages.filter(
    (l) => l !== defaultLanguage,
  )

  if (nonDefaultLanguages.length === 0) return null

  return (
    <InlineSection title="Translations">
      <div className="py-3">
        <Tabs defaultValue={nonDefaultLanguages[0]}>
          <TabsList>
            {nonDefaultLanguages.map((lang) => (
              <TabsTrigger key={lang} value={lang}>
                {LANGUAGE_NAMES[lang] ?? lang}
              </TabsTrigger>
            ))}
          </TabsList>

          {nonDefaultLanguages.map((lang) => (
            <TabsContent key={lang} value={lang}>
              <LanguageTab
                entityType={entityType}
                entityId={entityId}
                language={lang}
                translatableFields={translatableFields}
                sourceData={sourceData}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </InlineSection>
  )
}

function LanguageTab({
  entityType,
  entityId,
  language,
  translatableFields,
  sourceData,
}: {
  entityType: string
  entityId: string
  language: string
  translatableFields: string[]
  sourceData: Record<string, string | null | undefined>
}) {
  const { data: translations = [] } = useTranslationsQuery(entityType, entityId)
  const upsertMutation = useUpsertTranslation()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const existingTranslation = translations.find((t) => t.language === language)

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of translatableFields) {
      initial[field] = existingTranslation?.data[field] ?? ""
    }
    return initial
  })

  // Sync draft when data loads
  const translationData = existingTranslation?.data
  const [syncedId, setSyncedId] = useState<string | null>(null)
  if (existingTranslation && existingTranslation.id !== syncedId) {
    const updated: Record<string, string> = {}
    for (const field of translatableFields) {
      updated[field] = translationData?.[field] ?? ""
    }
    setDraft(updated)
    setSyncedId(existingTranslation.id)
  }

  const handleSave = () => {
    const data: Record<string, string> = {}
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim()) data[key] = value
    }

    upsertMutation.mutate(
      {
        entity_type: entityType,
        entity_id: entityId,
        language,
        data,
      },
      {
        onSuccess: () => showSuccessToast("Translation saved"),
        onError: (err) =>
          showErrorToast(
            err instanceof Error ? err.message : "Failed to save translation",
          ),
      },
    )
  }

  const handleAITranslated = (data: Record<string, string>) => {
    setDraft((prev) => ({ ...prev, ...data }))
  }

  const formatFieldLabel = (field: string) =>
    field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="space-y-4 pt-4">
      {translatableFields.map((field) => (
        <TranslationFieldEditor
          key={field}
          fieldName={field}
          label={formatFieldLabel(field)}
          originalValue={sourceData[field] ?? ""}
          translatedValue={draft[field] ?? ""}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, [field]: value }))
          }
          multiline={MULTILINE_FIELDS.has(field)}
        />
      ))}

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={upsertMutation.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          {upsertMutation.isPending ? "Saving..." : "Save Translation"}
        </Button>

        <AITranslateButton
          entityType={entityType}
          entityId={entityId}
          targetLanguage={language}
          onTranslated={handleAITranslated}
        />
      </div>
    </div>
  )
}
