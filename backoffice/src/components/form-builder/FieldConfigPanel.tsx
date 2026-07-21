import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  type FormFieldPublic,
  FormFieldsService,
  type FormFieldUpdate,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { PdfUpload } from "@/components/ui/pdf-upload"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { canRemoveField, FIELD_TYPES, isSpecialField } from "./constants"

type FieldWidth = "full" | "half" | "half_row" | null

interface FieldConfigPanelProps {
  field: FormFieldPublic
  onClose: () => void
  onFieldUpdated: (field: FormFieldPublic) => void
}

type FieldConfig = Record<string, unknown>

const CONFIG_TYPES = new Set([
  "rich_text",
  "image_upload",
  "country_select",
  "signature",
])

const NO_OPTIONS_TYPES = CONFIG_TYPES
const NO_PLACEHOLDER_TYPES = new Set([
  "select_cards",
  "rich_text",
  "signature",
  "radio",
])
const NO_DATE_RANGE_TYPES = CONFIG_TYPES

export function FieldConfigPanel({
  field,
  onClose: _onClose,
  onFieldUpdated,
}: FieldConfigPanelProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [localValues, setLocalValues] = useState({
    label: "",
    field_type: "text",
    placeholder: "",
    help_text: "",
    required: false,
    options: "",
    min_date: "",
    max_date: "",
    config: {} as FieldConfig,
    width: null as FieldWidth,
  })

  useEffect(() => {
    setLocalValues({
      label: field.label,
      field_type: field.field_type,
      placeholder: field.placeholder ?? "",
      help_text: field.help_text ?? "",
      required: field.required ?? false,
      options: field.options?.join("\n") ?? "",
      min_date: field.min_date ?? "",
      max_date: field.max_date ?? "",
      config: (field.config as FieldConfig | null) ?? {},
      width: (field.width as FieldWidth) ?? null,
    })
  }, [field])

  const updateMutation = useMutation({
    mutationFn: (data: { fieldId: string; requestBody: FormFieldUpdate }) =>
      FormFieldsService.updateFormField(data),
    onSuccess: (updated) => {
      onFieldUpdated(updated)
      showSuccessToast("Field saved")
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleChange = (
    key: string,
    value: string | boolean | FieldConfig | FieldWidth,
  ) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }))
  }

  const setConfig = (patch: FieldConfig) => {
    setLocalValues((prev) => ({
      ...prev,
      config: { ...prev.config, ...patch },
    }))
  }

  const isProtected = isSpecialField(field)
  const isElemental = isProtected && !canRemoveField(field)
  const allowedFieldTypes = field.allowed_field_types ?? null
  const hasAllowedFieldTypes =
    !!allowedFieldTypes && allowedFieldTypes.length > 0
  const typeSelectDisabled = isProtected && !hasAllowedFieldTypes
  const visibleFieldTypes = hasAllowedFieldTypes
    ? FIELD_TYPES.filter((t) => allowedFieldTypes?.includes(t.value))
    : FIELD_TYPES

  const handleSave = () => {
    const optionsArray = localValues.options
      .split("\n")
      .map((o) => o.trim())
      .filter((o) => o.length > 0)

    const requestBody: FormFieldUpdate = {
      label: localValues.label || undefined,
      help_text: localValues.help_text || undefined,
      options: optionsArray.length > 0 ? optionsArray : undefined,
      min_date: localValues.min_date || null,
      max_date: localValues.max_date || null,
    }

    // Elementals cannot change required; everyone else can.
    if (!isElemental) {
      requestBody.required = localValues.required
    }

    // Protected (base) fields have a fixed type defined by the catalog, unless
    // the catalog whitelists alternatives via `allowed_field_types`.
    if (!isProtected || hasAllowedFieldTypes) {
      requestBody.field_type = localValues.field_type || undefined
    }

    if (!NO_PLACEHOLDER_TYPES.has(localValues.field_type)) {
      requestBody.placeholder = localValues.placeholder || undefined
    }

    if (
      CONFIG_TYPES.has(localValues.field_type) ||
      localValues.field_type === "multiselect_detailed"
    ) {
      requestBody.config = localValues.config
    }

    // Always include width — sending `null` is how the admin reverts to "auto"
    // (type-based heuristic).
    requestBody.width = localValues.width

    updateMutation.mutate({ fieldId: field.id, requestBody })
  }

  const ft = localValues.field_type
  const showOptions =
    !NO_OPTIONS_TYPES.has(ft) &&
    (ft === "select" ||
      ft === "select_cards" ||
      ft === "multiselect" ||
      ft === "radio" ||
      ft === "multiselect_detailed")
  const showDateRange = !NO_DATE_RANGE_TYPES.has(ft) && ft === "date"
  const showPlaceholder = !NO_PLACEHOLDER_TYPES.has(ft)
  const showRichTextConfig = ft === "rich_text"
  const showImageUploadConfig = ft === "image_upload"
  const showSignatureConfig = ft === "signature"
  const showDetailedMultiSelectConfig = ft === "multiselect_detailed"
  // rich_text is purely a content block — its label/help-text inputs are
  // never rendered to the user, so hide them in the config panel too.
  const showLabelAndHelpText = ft !== "rich_text"

  return (
    <div className="space-y-5 px-4 pb-6">
      {isElemental && (
        <p className="text-sm text-muted-foreground rounded-md bg-muted/30 px-3 py-2">
          Elemental field — always required and always asked. Only label,
          placeholder, and help text are editable.
        </p>
      )}
      {isProtected && !isElemental && (
        <p className="text-sm text-muted-foreground rounded-md bg-muted/30 px-3 py-2">
          Predefined field — the type is fixed by the catalog. Everything else
          is editable, and the field can be removed from this popup.
        </p>
      )}
      {showLabelAndHelpText && (
        <div className="space-y-2">
          <Label htmlFor="config-label">Display Label</Label>
          <Input
            id="config-label"
            value={localValues.label}
            onChange={(e) => handleChange("label", e.target.value)}
            placeholder="Field label"
          />
          <p className="text-xs text-muted-foreground">Key: {field.name}</p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="config-type">Field Type</Label>
        <Select
          value={localValues.field_type}
          onValueChange={(val) => handleChange("field_type", val)}
        >
          <SelectTrigger disabled={typeSelectDisabled}>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {visibleFieldTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showPlaceholder && (
        <div className="space-y-2">
          <Label htmlFor="config-placeholder">Placeholder</Label>
          <Input
            id="config-placeholder"
            value={localValues.placeholder}
            onChange={(e) => handleChange("placeholder", e.target.value)}
            placeholder="Enter placeholder text..."
          />
        </div>
      )}

      {showLabelAndHelpText && (
        <div className="space-y-2">
          <Label htmlFor="config-help">Help Text</Label>
          <Textarea
            id="config-help"
            value={localValues.help_text}
            onChange={(e) => handleChange("help_text", e.target.value)}
            placeholder="Additional instructions..."
            rows={2}
          />
        </div>
      )}

      {showOptions && !showDetailedMultiSelectConfig && (
        <div className="space-y-2">
          <Label htmlFor="config-options">Options</Label>
          <Textarea
            id="config-options"
            value={localValues.options}
            onChange={(e) => handleChange("options", e.target.value)}
            placeholder={"Option 1\nOption 2\nOption 3"}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">One option per line</p>
        </div>
      )}

      {showDetailedMultiSelectConfig && (
        <DetailedOptionsEditor
          optionsText={localValues.options}
          subtitles={
            (localValues.config.subtitles as Record<string, string>) ?? {}
          }
          onChange={(nextOptions, nextSubtitles) => {
            setLocalValues((prev) => ({
              ...prev,
              options: nextOptions,
              config: { ...prev.config, subtitles: nextSubtitles },
            }))
          }}
        />
      )}

      {showDetailedMultiSelectConfig && (
        <DetailedMinMaxInputs
          minSelections={
            (localValues.config.min_selections as number | undefined) ??
            undefined
          }
          maxSelections={
            (localValues.config.max_selections as number | undefined) ??
            undefined
          }
          onChange={(min, max) =>
            setConfig({ min_selections: min, max_selections: max })
          }
        />
      )}

      {showDateRange && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="config-min-date">Minimum date</Label>
            <Input
              id="config-min-date"
              type="date"
              value={localValues.min_date}
              onChange={(e) => handleChange("min_date", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="config-max-date">Maximum date</Label>
            <Input
              id="config-max-date"
              type="date"
              value={localValues.max_date}
              onChange={(e) => handleChange("max_date", e.target.value)}
            />
          </div>
        </div>
      )}

      {showRichTextConfig && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="config-md-content">Markdown content</Label>
            <Textarea
              id="config-md-content"
              value={(localValues.config.content as string) ?? ""}
              onChange={(e) => setConfig({ content: e.target.value })}
              placeholder="By clicking here I accept the [terms](https://example.com/terms)."
              rows={8}
            />
            <p className="text-xs text-muted-foreground">
              Markdown supported: **bold**, _italic_, [link text](https://url),
              lists, etc. Links open in a new tab.
            </p>
          </div>
          <div
            className={
              "rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground " +
              "[&>p]:my-0 [&>p+p]:mt-2 " +
              "[&>ul]:my-1 [&>ul]:list-disc [&>ul]:pl-5 " +
              "[&>ol]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 " +
              "[&_strong]:font-semibold [&_em]:italic " +
              "[&_a]:text-primary [&_a]:underline"
            }
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {(localValues.config.content as string) || "*Preview*"}
            </ReactMarkdown>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="config-is-checkbox">Show as checkbox</Label>
              <p className="text-xs text-muted-foreground">
                Renders an acceptance checkbox alongside the text.
              </p>
            </div>
            <Switch
              id="config-is-checkbox"
              checked={!!localValues.config.is_checkbox}
              onCheckedChange={(val) => setConfig({ is_checkbox: val })}
            />
          </div>
        </div>
      )}

      {showImageUploadConfig && (
        <div className="space-y-2">
          <Label htmlFor="config-button-text">Button text</Label>
          <Input
            id="config-button-text"
            value={(localValues.config.button_text as string) ?? ""}
            onChange={(e) => setConfig({ button_text: e.target.value })}
            placeholder="Upload image"
          />
        </div>
      )}

      {showSignatureConfig && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Agreement PDF</Label>
            <PdfUpload
              value={(localValues.config.pdf_url as string | null) ?? null}
              onChange={(url) => setConfig({ pdf_url: url ?? "" })}
            />
            <p className="text-xs text-muted-foreground">
              Users will see this PDF inline before signing.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="config-require-date">
                Require signature date
              </Label>
              <p className="text-xs text-muted-foreground">
                Adds a date input alongside the signature.
              </p>
            </div>
            <Switch
              id="config-require-date"
              checked={!!localValues.config.require_date}
              onCheckedChange={(val) => setConfig({ require_date: val })}
            />
          </div>
        </div>
      )}

      <Separator />

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="config-required">Required</Label>
          <p className="text-xs text-muted-foreground">
            Must be filled to submit
          </p>
        </div>
        <Switch
          id="config-required"
          checked={localValues.required}
          onCheckedChange={(val) => handleChange("required", val)}
          disabled={isElemental}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="config-width">Field width</Label>
        <Select
          value={localValues.width ?? "auto"}
          onValueChange={(val) =>
            handleChange("width", val === "auto" ? null : (val as FieldWidth))
          }
        >
          <SelectTrigger id="config-width">
            <SelectValue placeholder="Auto (by type)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (by type)</SelectItem>
            <SelectItem value="half">Half (one column)</SelectItem>
            <SelectItem value="half_row">Half (alone in row)</SelectItem>
            <SelectItem value="full">Full (both columns)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Auto picks a sensible default for the field type. Override to force a
          specific column span.
        </p>
      </div>

      <Separator />

      <LoadingButton
        className="w-full"
        loading={updateMutation.isPending}
        onClick={handleSave}
      >
        Save Changes
      </LoadingButton>
    </div>
  )
}

interface DetailedOptionsEditorProps {
  optionsText: string
  subtitles: Record<string, string>
  onChange: (
    nextOptionsText: string,
    nextSubtitles: Record<string, string>,
  ) => void
}

function DetailedOptionsEditor({
  optionsText,
  subtitles,
  onChange,
}: DetailedOptionsEditorProps) {
  const rows = optionsText.split("\n")

  const commit = (
    nextRows: string[],
    nextSubtitles: Record<string, string>,
  ) => {
    onChange(nextRows.join("\n"), nextSubtitles)
  }

  const updateTitle = (index: number, nextTitle: string) => {
    const prevTitle = rows[index] ?? ""
    const nextRows = rows.slice()
    nextRows[index] = nextTitle
    const nextSubs = { ...subtitles }
    const sub = nextSubs[prevTitle]
    if (prevTitle && prevTitle !== nextTitle) {
      delete nextSubs[prevTitle]
    }
    if (nextTitle && sub !== undefined) {
      nextSubs[nextTitle] = sub
    }
    commit(nextRows, nextSubs)
  }

  const updateSubtitle = (index: number, nextSubtitle: string) => {
    const title = rows[index] ?? ""
    if (!title) {
      commit(rows, subtitles)
      return
    }
    const nextSubs = { ...subtitles }
    if (nextSubtitle === "") {
      delete nextSubs[title]
    } else {
      nextSubs[title] = nextSubtitle
    }
    commit(rows, nextSubs)
  }

  const removeRow = (index: number) => {
    const title = rows[index] ?? ""
    const nextRows = rows.slice()
    nextRows.splice(index, 1)
    const nextSubs = { ...subtitles }
    if (title) delete nextSubs[title]
    commit(nextRows.length > 0 ? nextRows : [""], nextSubs)
  }

  const addRow = () => {
    commit([...rows, ""], subtitles)
  }

  return (
    <div className="space-y-2">
      <Label>Options</Label>
      <div className="space-y-2">
        {rows.map((title, idx) => (
          <div
            key={`opt-${idx}`}
            className="space-y-1 rounded-md border border-input p-2"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Input
                  value={title}
                  onChange={(e) => updateTitle(idx, e.target.value)}
                  placeholder="Title"
                />
                <Input
                  value={subtitles[title] ?? ""}
                  onChange={(e) => updateSubtitle(idx, e.target.value)}
                  placeholder="Subtitle (optional)"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove option"
                onClick={() => removeRow(idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="gap-1"
      >
        <Plus className="h-3.5 w-3.5" /> Add option
      </Button>
    </div>
  )
}

interface DetailedMinMaxInputsProps {
  minSelections: number | undefined
  maxSelections: number | undefined
  onChange: (min: number | null, max: number | null) => void
}

function DetailedMinMaxInputs({
  minSelections,
  maxSelections,
  onChange,
}: DetailedMinMaxInputsProps) {
  const parse = (raw: string): number | null => {
    if (raw === "") return null
    const n = Number(raw)
    if (Number.isNaN(n) || n < 0) return null
    return Math.floor(n)
  }

  const minTouched = typeof minSelections === "number"
  const maxTouched = typeof maxSelections === "number"
  const minGreaterThanMax =
    minTouched && maxTouched && (minSelections ?? 0) > (maxSelections ?? 0)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="config-min-selections">Min selections</Label>
          <Input
            id="config-min-selections"
            type="number"
            min={0}
            value={minSelections ?? ""}
            onChange={(e) =>
              onChange(parse(e.target.value), maxSelections ?? null)
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="config-max-selections">Max selections</Label>
          <Input
            id="config-max-selections"
            type="number"
            min={0}
            value={maxSelections ?? ""}
            onChange={(e) =>
              onChange(minSelections ?? null, parse(e.target.value))
            }
            placeholder="No limit"
          />
        </div>
      </div>
      {minGreaterThanMax && (
        <p className="text-xs text-destructive">
          Min selections must be ≤ max selections.
        </p>
      )}
    </div>
  )
}
