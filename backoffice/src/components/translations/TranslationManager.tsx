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
import {
  buildPartialConfig,
  type ConfigLeaf,
  extractTranslatableLeaves,
  flattenConfigValues,
} from "./templateConfigLeaves"

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  is: "Íslenska",
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
  // Optional nested-config translation (e.g. a ticketing step's
  // template_config): text leaves are auto-extracted and saved as a partial
  // mirror under `nestedField` in the same translation row.
  nestedField?: string
  nestedSource?: unknown
}

export function TranslationManager({
  entityType,
  entityId,
  translatableFields,
  sourceData,
  supportedLanguages,
  defaultLanguage = "en",
  nestedField,
  nestedSource,
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
                nestedField={nestedField}
                nestedSource={nestedSource}
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
  nestedField,
  nestedSource,
}: {
  entityType: string
  entityId: string
  language: string
  translatableFields: string[]
  sourceData: Record<string, string | null | undefined>
  nestedField?: string
  nestedSource?: unknown
}) {
  const { data: translations = [] } = useTranslationsQuery(entityType, entityId)
  const upsertMutation = useUpsertTranslation()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const existingTranslation = translations.find((t) => t.language === language)

  const leaves: ConfigLeaf[] = nestedField
    ? extractTranslatableLeaves(nestedSource)
    : []

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of translatableFields) {
      initial[field] = (existingTranslation?.data[field] as string) ?? ""
    }
    return initial
  })

  const [nestedDraft, setNestedDraft] = useState<Record<string, string>>(() =>
    nestedField
      ? flattenConfigValues(existingTranslation?.data[nestedField])
      : {},
  )

  // Sync drafts when the persisted translation loads or changes identity.
  const [syncedId, setSyncedId] = useState<string | null>(null)
  if (existingTranslation && existingTranslation.id !== syncedId) {
    const updated: Record<string, string> = {}
    for (const field of translatableFields) {
      updated[field] = (existingTranslation.data[field] as string) ?? ""
    }
    setDraft(updated)
    if (nestedField) {
      setNestedDraft(flattenConfigValues(existingTranslation.data[nestedField]))
    }
    setSyncedId(existingTranslation.id)
  }

  const handleSave = () => {
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim()) data[key] = value
    }
    if (nestedField) {
      const partial = buildPartialConfig(nestedDraft)
      if (partial) data[nestedField] = partial
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

      {leaves.length > 0 && (
        <div className="space-y-4 border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground">
            Step content
          </p>
          {leaves.map((leaf) => (
            <TranslationFieldEditor
              key={leaf.path}
              fieldName={leaf.path}
              label={leaf.label}
              originalValue={leaf.value}
              translatedValue={nestedDraft[leaf.path] ?? ""}
              onChange={(value) =>
                setNestedDraft((prev) => ({ ...prev, [leaf.path]: value }))
              }
              multiline={leaf.multiline}
            />
          ))}
        </div>
      )}

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
