import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
  type FormFieldPublic,
  FormFieldsService,
  type FormFieldUpdate,
} from "@/client"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { canRemoveField, FIELD_TYPES, isSpecialField } from "./constants"

interface FieldConfigPanelProps {
  field: FormFieldPublic
  onClose: () => void
  onFieldUpdated: (field: FormFieldPublic) => void
}

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

  const handleChange = (key: string, value: string | boolean) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }))
  }

  const isProtected = isSpecialField(field)
  const isElemental = isProtected && !canRemoveField(field)

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

    // Protected (base) fields have a fixed type defined by the catalog.
    if (!isProtected) {
      requestBody.field_type = localValues.field_type || undefined
    }

    if (localValues.field_type !== "select_cards") {
      requestBody.placeholder = localValues.placeholder || undefined
    }

    updateMutation.mutate({ fieldId: field.id, requestBody })
  }

  const showOptions =
    localValues.field_type === "select" ||
    localValues.field_type === "select_cards" ||
    localValues.field_type === "multiselect"

  const showDateRange = localValues.field_type === "date"

  const showPlaceholder = localValues.field_type !== "select_cards"

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
      <div className="space-y-2">
        <Label htmlFor="config-label">Display Label</Label>
        <Input
          id="config-label"
          value={localValues.label}
          onChange={(e) => handleChange("label", e.target.value)}
          placeholder="Field label"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="config-type">Field Type</Label>
        <Select
          value={localValues.field_type}
          onValueChange={(val) => handleChange("field_type", val)}
        >
          <SelectTrigger disabled={isProtected}>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((type) => (
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

      {showOptions && (
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
