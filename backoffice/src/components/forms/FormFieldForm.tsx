import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  Hash,
  Link,
  List,
  ListChecks,
  Mail,
  Type,
} from "lucide-react"

import {
  type FormFieldCreate,
  type FormFieldPublic,
  FormFieldsService,
  type FormFieldUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const FIELD_TYPES = [
  { value: "text", label: "Text", icon: Type },
  { value: "textarea", label: "Text Area", icon: AlignLeft },
  { value: "number", label: "Number", icon: Hash },
  { value: "boolean", label: "Boolean (Yes/No)", icon: CheckSquare },
  { value: "select", label: "Select (Single)", icon: List },
  { value: "multiselect", label: "Multi-Select", icon: ListChecks },
  { value: "date", label: "Date", icon: Calendar },
  { value: "email", label: "Email", icon: Mail },
  { value: "url", label: "URL", icon: Link },
]

interface FormFieldFormProps {
  defaultValues?: FormFieldPublic
  onSuccess: () => void
}

export function FormFieldForm({
  defaultValues,
  onSuccess,
}: FormFieldFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const createMutation = useMutation({
    mutationFn: (data: FormFieldCreate) =>
      FormFieldsService.createFormField({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Form field created successfully")
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: FormFieldUpdate) =>
      FormFieldsService.updateFormField({
        fieldId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Form field updated successfully")
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      FormFieldsService.deleteFormField({ fieldId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Form field deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      navigate({ to: "/form-builder" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      label: defaultValues?.label ?? "",
      field_type: defaultValues?.field_type ?? "text",
      section: defaultValues?.section ?? "",
      position: defaultValues?.position?.toString() ?? "0",
      required: defaultValues?.required ?? false,
      options: defaultValues?.options?.join("\n") ?? "",
      placeholder: defaultValues?.placeholder ?? "",
      help_text: defaultValues?.help_text ?? "",
    },
    onSubmit: ({ value }) => {
      if (readOnly) return

      const optionsArray = value.options
        .split("\n")
        .map((o) => o.trim())
        .filter((o) => o.length > 0)

      if (isEdit) {
        updateMutation.mutate({
          name: value.name,
          label: value.label,
          field_type: value.field_type,
          section: value.section || undefined,
          position: Number.parseInt(value.position, 10) || 0,
          required: value.required,
          options: optionsArray.length > 0 ? optionsArray : undefined,
          placeholder: value.placeholder || undefined,
          help_text: value.help_text || undefined,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          name: value.name,
          label: value.label,
          field_type: value.field_type,
          section: value.section || undefined,
          position: Number.parseInt(value.position, 10) || 0,
          required: value.required,
          options: optionsArray.length > 0 ? optionsArray : undefined,
          placeholder: value.placeholder || undefined,
          help_text: value.help_text || undefined,
        })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Show alert if no popup selected (only for create mode)
  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="form field" action="create" />
  }

  const getFieldTypeInfo = (type: string) =>
    FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0]

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly) {
            form.handleSubmit()
          }
        }}
        className="space-y-6"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Form Fields */}
          <div className="space-y-6 lg:col-span-2">
            {/* Basic Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {readOnly
                    ? "Form Field Details"
                    : isEdit
                      ? "Basic Configuration"
                      : "Form Field Details"}
                </CardTitle>
                <CardDescription>
                  {readOnly
                    ? "View form field configuration (read-only)"
                    : isEdit
                      ? "Update the form field configuration"
                      : "Configure a custom field for applications"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field
                    name="name"
                    validators={{
                      onBlur: ({ value }) =>
                        !readOnly && !value ? "Name is required" : undefined,
                    }}
                  >
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="name">
                          Field Name{" "}
                          {!readOnly && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <Input
                          id="name"
                          placeholder="dietary_restrictions"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                        <p className="text-sm text-muted-foreground">
                          Internal identifier (no spaces)
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {field.state.meta.errors.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  <form.Field
                    name="label"
                    validators={{
                      onBlur: ({ value }) =>
                        !readOnly && !value ? "Label is required" : undefined,
                    }}
                  >
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="label">
                          Display Label{" "}
                          {!readOnly && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <Input
                          id="label"
                          placeholder="Dietary Restrictions"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                        <p className="text-sm text-muted-foreground">
                          Label shown to users
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {field.state.meta.errors.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="field_type">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="field_type">Field Type</Label>
                        <Select
                          value={field.state.value}
                          onValueChange={(val) => field.handleChange(val)}
                          disabled={readOnly}
                        >
                          <SelectTrigger>
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
                    )}
                  </form.Field>

                  <form.Field name="section">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="section">Section</Label>
                        <Input
                          id="section"
                          placeholder="preferences"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                        <p className="text-sm text-muted-foreground">
                          Group fields by section
                        </p>
                      </div>
                    )}
                  </form.Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="position">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="position">Position</Label>
                        <Input
                          id="position"
                          type="number"
                          min={0}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                        <p className="text-sm text-muted-foreground">
                          Display order (lower = first)
                        </p>
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="placeholder">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="placeholder">Placeholder</Label>
                        <Input
                          id="placeholder"
                          placeholder="Enter your answer..."
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                      </div>
                    )}
                  </form.Field>
                </div>

                <form.Subscribe selector={(state) => state.values.field_type}>
                  {(fieldType) =>
                    (fieldType === "select" || fieldType === "multiselect") && (
                      <form.Field name="options">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor="options">Options</Label>
                            <Textarea
                              id="options"
                              placeholder="Option 1&#10;Option 2&#10;Option 3"
                              rows={4}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                              disabled={readOnly}
                            />
                            <p className="text-sm text-muted-foreground">
                              One option per line
                            </p>
                          </div>
                        )}
                      </form.Field>
                    )
                  }
                </form.Subscribe>

                <form.Field name="help_text">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="help_text">Help Text</Label>
                      <Textarea
                        id="help_text"
                        placeholder="Additional instructions for the user..."
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
                <CardDescription>Field validation and behavior</CardDescription>
              </CardHeader>
              <CardContent>
                <form.Field name="required">
                  {(field) => (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="required">Required</Label>
                        <p className="text-sm text-muted-foreground">
                          Must be filled to submit the form
                        </p>
                      </div>
                      <Switch
                        id="required"
                        checked={field.state.value}
                        onCheckedChange={(val) => field.handleChange(val)}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/form-builder" })}
              >
                {readOnly ? "Back" : "Cancel"}
              </Button>
              {!readOnly && (
                <LoadingButton type="submit" loading={isPending}>
                  {isEdit ? "Save Changes" : "Create Field"}
                </LoadingButton>
              )}
            </div>
          </div>

          {/* Right Column - Preview */}
          <div className="space-y-6">
            <form.Subscribe
              selector={(state) => ({
                name: state.values.name,
                label: state.values.label,
                field_type: state.values.field_type,
                section: state.values.section,
                position: state.values.position,
                required: state.values.required,
                placeholder: state.values.placeholder,
                help_text: state.values.help_text,
                options: state.values.options,
              })}
            >
              {(values) => {
                const typeInfo = getFieldTypeInfo(values.field_type)
                const TypeIcon = typeInfo.icon

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Preview</CardTitle>
                      <CardDescription>
                        How this field will appear
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <TypeIcon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium leading-none">
                              {values.label || "Field Label"}
                            </p>
                            {values.required && (
                              <span className="text-destructive">*</span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {typeInfo.label}
                          </p>
                        </div>
                      </div>

                      <Separator />

                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Name</span>
                          <code className="font-mono text-xs">
                            {values.name || "field_name"}
                          </code>
                        </div>

                        {values.section && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              Section
                            </span>
                            <span>{values.section}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Position
                          </span>
                          <span>{values.position || "0"}</span>
                        </div>
                      </div>

                      {values.placeholder && (
                        <>
                          <Separator />
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              Placeholder
                            </p>
                            <p className="text-sm italic text-muted-foreground">
                              {values.placeholder}
                            </p>
                          </div>
                        </>
                      )}

                      {values.help_text && (
                        <>
                          <Separator />
                          <p className="text-sm text-muted-foreground">
                            {values.help_text}
                          </p>
                        </>
                      )}

                      {(values.field_type === "select" ||
                        values.field_type === "multiselect") &&
                        values.options && (
                          <>
                            <Separator />
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">
                                Options
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {values.options
                                  .split("\n")
                                  .filter((o) => o.trim())
                                  .slice(0, 5)
                                  .map((opt, i) => (
                                    <Badge key={i} variant="secondary">
                                      {opt.trim()}
                                    </Badge>
                                  ))}
                                {values.options
                                  .split("\n")
                                  .filter((o) => o.trim()).length > 5 && (
                                  <Badge variant="outline">
                                    +
                                    {values.options
                                      .split("\n")
                                      .filter((o) => o.trim()).length - 5}{" "}
                                    more
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </>
                        )}

                      <Separator />

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Required
                        </span>
                        <Badge
                          variant={values.required ? "default" : "secondary"}
                        >
                          {values.required ? "Yes" : "No"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                )
              }}
            </form.Subscribe>

            {isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Field Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Field ID</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {defaultValues.id}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </form>

      {isEdit && !readOnly && (
        <DangerZone
          description="Once you delete this form field, applications may lose their stored data for this field. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Field"
          resourceName={defaultValues.label}
        />
      )}
    </div>
  )
}
