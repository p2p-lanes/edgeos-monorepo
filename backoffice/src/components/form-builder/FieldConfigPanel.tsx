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
import { FIELD_TYPES, isSpecialField } from "./constants"

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
  })

  useEffect(() => {
    setLocalValues({
      label: field.label,
      field_type: field.field_type,
      placeholder: field.placeholder ?? "",
      help_text: field.help_text ?? "",
      required: field.required ?? false,
      options: field.options?.join("\n") ?? "",
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

  const handleSave = () => {
    if (isSpecialField(field)) {
      updateMutation.mutate({
        fieldId: field.id,
        requestBody: {
          placeholder: localValues.placeholder || undefined,
          help_text: localValues.help_text || undefined,
        },
      })
      return
    }
    const optionsArray = localValues.options
      .split("\n")
      .map((o) => o.trim())
      .filter((o) => o.length > 0)

    updateMutation.mutate({
      fieldId: field.id,
      requestBody: {
        label: localValues.label || undefined,
        field_type: localValues.field_type || undefined,
        placeholder: localValues.placeholder || undefined,
        help_text: localValues.help_text || undefined,
        required: localValues.required,
        options: optionsArray.length > 0 ? optionsArray : undefined,
      },
    })
  }

  const showOptions =
    localValues.field_type === "select" ||
    localValues.field_type === "multiselect"

  const isProtected = isSpecialField(field)

  return (
    <div className="space-y-5 px-4 pb-6">
      {isProtected && (
        <p className="text-sm text-muted-foreground rounded-md bg-muted/30 px-3 py-2">
          Protected field – only placeholder and help text can be edited.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="config-label">Display Label</Label>
        <Input
          id="config-label"
          value={localValues.label}
          onChange={(e) => handleChange("label", e.target.value)}
          placeholder="Field label"
          disabled={isProtected}
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

      <div className="space-y-2">
        <Label htmlFor="config-placeholder">Placeholder</Label>
        <Input
          id="config-placeholder"
          value={localValues.placeholder}
          onChange={(e) => handleChange("placeholder", e.target.value)}
          placeholder="Enter placeholder text..."
        />
      </div>

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
            disabled={isProtected}
          />
          <p className="text-xs text-muted-foreground">One option per line</p>
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
          disabled={isProtected}
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
