import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import {
  type ApplicationAdminCreate,
  type ApplicationStatus,
  ApplicationsService,
  type CompanionCreate,
  FormFieldsService,
} from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

// Type for the application schema response
interface FormFieldSchema {
  type: string
  label: string
  required: boolean
  section: string
  position?: number
  options?: string[]
  placeholder?: string
  help_text?: string
}

interface ApplicationSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: string[]
}

// Type for companion with client-side ID for React key
interface CompanionWithId extends CompanionCreate {
  _id: string
}

interface ApplicationFormProps {
  onSuccess: () => void
}

export function ApplicationForm({ onSuccess }: ApplicationFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()

  // State for companions (spouse/kids) with client-side IDs for React keys
  const [companions, setCompanions] = useState<CompanionWithId[]>([])
  // Track if saving as draft
  const [savingAsDraft, setSavingAsDraft] = useState(false)

  // Check if spouse already added
  const hasSpouse = companions.some((c) => c.category === "spouse")

  // Fetch schema for the selected popup
  const {
    data: schema,
    isLoading: schemaLoading,
    isError: _schemaError,
  } = useQuery({
    queryKey: ["form-fields-schema", selectedPopupId],
    queryFn: async () => {
      if (!selectedPopupId) return null
      const result = await FormFieldsService.getApplicationSchema({
        popupId: selectedPopupId,
      })
      return result as unknown as ApplicationSchema
    },
    enabled: !!selectedPopupId,
  })

  const createMutation = useMutation({
    mutationFn: (data: ApplicationAdminCreate) =>
      ApplicationsService.createApplicationAdmin({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Application created successfully")
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  // Build initial custom fields values
  const getInitialCustomFields = (): Record<string, unknown> => {
    if (!schema?.custom_fields) return {}
    const initial: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(schema.custom_fields)) {
      if (field.type === "boolean") {
        initial[name] = false
      } else if (field.type === "multiselect") {
        initial[name] = []
      } else {
        initial[name] = ""
      }
    }
    return initial
  }

  const form = useForm({
    defaultValues: {
      // Base profile fields
      first_name: "",
      last_name: "",
      email: "",
      telegram: "",
      organization: "",
      role: "",
      gender: "",
      age: "",
      residence: "",
      // Application fields
      referral: "",
      // Custom fields - will be populated dynamically
      custom_fields: getInitialCustomFields(),
    },
    onSubmit: ({ value }) => {
      if (!selectedPopupId) {
        showErrorToast("Please select a popup first")
        return
      }

      // Clean up custom fields - remove empty values
      const cleanedCustomFields: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value.custom_fields)) {
        if (val !== "" && val !== null && val !== undefined) {
          if (Array.isArray(val) && val.length === 0) continue
          cleanedCustomFields[key] = val
        }
      }

      // Status is "draft" if saving as draft, otherwise "in review"
      const status = savingAsDraft ? "draft" : "in review"

      createMutation.mutate({
        popup_id: selectedPopupId,
        first_name: value.first_name,
        last_name: value.last_name,
        email: value.email,
        telegram: value.telegram || undefined,
        organization: value.organization || undefined,
        role: value.role || undefined,
        gender: value.gender || undefined,
        age: value.age || undefined,
        residence: value.residence || undefined,
        referral: value.referral || undefined,
        status: status as ApplicationStatus,
        custom_fields:
          Object.keys(cleanedCustomFields).length > 0
            ? cleanedCustomFields
            : undefined,
        companions:
          companions.length > 0
            ? companions.map(({ _id, ...rest }) => rest)
            : undefined,
      })
    },
  })

  // Show alert if no popup selected
  if (!isContextReady) {
    return <WorkspaceAlert resource="application" action="create" />
  }

  if (schemaLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  // Sort custom fields by position
  const sortedCustomFields = schema?.custom_fields
    ? Object.entries(schema.custom_fields).sort(
        ([, a], [, b]) => (a.position ?? 0) - (b.position ?? 0),
      )
    : []

  // Group custom fields by section
  const fieldsBySection: Record<string, [string, FormFieldSchema][]> = {}
  for (const [name, field] of sortedCustomFields) {
    const section = field.section || "custom"
    if (!fieldsBySection[section]) {
      fieldsBySection[section] = []
    }
    fieldsBySection[section].push([name, field])
  }

  const getRequiredValidator = (fieldSchema: FormFieldSchema) => {
    if (!fieldSchema.required) return undefined
    return {
      onBlur: ({ value }: { value: unknown }) => {
        if (fieldSchema.type === "boolean") {
          return value !== true ? `${fieldSchema.label} is required` : undefined
        }
        if (fieldSchema.type === "multiselect") {
          return !Array.isArray(value) || value.length === 0
            ? `${fieldSchema.label} is required`
            : undefined
        }
        return !value ? `${fieldSchema.label} is required` : undefined
      },
    }
  }

  const renderFieldError = (errors: string[]) => {
    if (errors.length === 0) return null
    return <p className="text-destructive text-sm">{errors.join(", ")}</p>
  }

  const renderCustomField = (name: string, field: FormFieldSchema) => {
    const fieldPath = `custom_fields.${name}` as const
    const validators = getRequiredValidator(field)

    switch (field.type) {
      case "text":
      case "email":
      case "url":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <Label htmlFor={name}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <Input
                  id={name}
                  type={field.type === "email" ? "email" : "text"}
                  placeholder={field.placeholder}
                  value={(formField.state.value as string) || ""}
                  onBlur={formField.handleBlur}
                  onChange={(e) => formField.handleChange(e.target.value)}
                />
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      case "textarea":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <Label htmlFor={name}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <Textarea
                  id={name}
                  placeholder={field.placeholder}
                  value={(formField.state.value as string) || ""}
                  onBlur={formField.handleBlur}
                  onChange={(e) => formField.handleChange(e.target.value)}
                />
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      case "number":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <Label htmlFor={name}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <Input
                  id={name}
                  type="number"
                  placeholder={field.placeholder}
                  value={(formField.state.value as string) || ""}
                  onBlur={formField.handleBlur}
                  onChange={(e) => formField.handleChange(e.target.value)}
                />
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      case "boolean":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={name}
                    checked={(formField.state.value as boolean) || false}
                    onCheckedChange={(checked) => {
                      formField.handleChange(checked)
                      formField.handleBlur()
                    }}
                  />
                  <Label htmlFor={name} className="font-normal">
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </Label>
                </div>
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      case "select":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <Label htmlFor={name}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <Select
                  value={(formField.state.value as string) || ""}
                  onValueChange={(val) => {
                    formField.handleChange(val)
                    formField.handleBlur()
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={field.placeholder || "Select..."}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      case "multiselect":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => {
              const selectedValues = (formField.state.value as string[]) || []
              return (
                <div className="space-y-2">
                  <Label>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive"> *</span>
                    )}
                  </Label>
                  <div className="space-y-2 rounded-md border p-3">
                    {field.options?.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <Checkbox
                          id={`${name}-${option}`}
                          checked={selectedValues.includes(option)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              formField.handleChange([
                                ...selectedValues,
                                option,
                              ])
                            } else {
                              formField.handleChange(
                                selectedValues.filter((v) => v !== option),
                              )
                            }
                            formField.handleBlur()
                          }}
                        />
                        <Label
                          htmlFor={`${name}-${option}`}
                          className="font-normal"
                        >
                          {option}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {field.help_text && (
                    <p className="text-sm text-muted-foreground">
                      {field.help_text}
                    </p>
                  )}
                  {renderFieldError(formField.state.meta.errors as string[])}
                </div>
              )
            }}
          </form.Field>
        )

      case "date":
        return (
          <form.Field name={fieldPath} key={name} validators={validators}>
            {(formField) => (
              <div className="space-y-2">
                <Label htmlFor={name}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <Input
                  id={name}
                  type="date"
                  value={(formField.state.value as string) || ""}
                  onBlur={formField.handleBlur}
                  onChange={(e) => formField.handleChange(e.target.value)}
                />
                {field.help_text && (
                  <p className="text-sm text-muted-foreground">
                    {field.help_text}
                  </p>
                )}
                {renderFieldError(formField.state.meta.errors as string[])}
              </div>
            )}
          </form.Field>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile Information */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Basic applicant information</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
            className="space-y-6"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <form.Field
                name="first_name"
                validators={{
                  onBlur: ({ value }) =>
                    !value ? "First name is required" : undefined,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="first_name">
                      First Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="first_name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field
                name="last_name"
                validators={{
                  onBlur: ({ value }) =>
                    !value ? "Last name is required" : undefined,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="last_name">
                      Last Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="last_name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field
              name="email"
              validators={{
                onBlur: ({ value }) =>
                  !value ? "Email is required" : undefined,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="grid gap-4 md:grid-cols-2">
              <form.Field name="telegram">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="telegram">Telegram</Label>
                    <Input
                      id="telegram"
                      placeholder="@username"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="organization">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="organization">Organization</Label>
                    <Input
                      id="organization"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <form.Field name="role">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Input
                      id="role"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="gender">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(val) => field.handleChange(val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                        <SelectItem value="prefer not to say">
                          Prefer not to say
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <form.Field name="age">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="age">Age Range</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(val) => field.handleChange(val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="18-24">18-24</SelectItem>
                        <SelectItem value="25-34">25-34</SelectItem>
                        <SelectItem value="35-44">35-44</SelectItem>
                        <SelectItem value="45-54">45-54</SelectItem>
                        <SelectItem value="55-64">55-64</SelectItem>
                        <SelectItem value="65+">65+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>

              <form.Field name="residence">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="residence">Residence</Label>
                    <Input
                      id="residence"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="referral">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="referral">How did you hear about us?</Label>
                  <Input
                    id="referral"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </form>
        </CardContent>
      </Card>

      {/* Companions (Spouse/Kids) */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Companions</CardTitle>
          <CardDescription>
            Add spouse or children attending with the applicant
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {companions.map((companion) => (
            <div
              key={companion._id}
              className="flex items-start gap-4 rounded-lg border p-4"
            >
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize text-muted-foreground">
                    {companion.category === "spouse" ? "Spouse" : "Child"}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={companion.name}
                      onChange={(e) => {
                        setCompanions((prev) =>
                          prev.map((c) =>
                            c._id === companion._id
                              ? { ...c, name: e.target.value }
                              : c,
                          ),
                        )
                      }}
                      placeholder="Full name"
                    />
                  </div>
                  {companion.category === "spouse" && (
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={companion.email || ""}
                        onChange={(e) => {
                          setCompanions((prev) =>
                            prev.map((c) =>
                              c._id === companion._id
                                ? { ...c, email: e.target.value || null }
                                : c,
                            ),
                          )
                        }}
                        placeholder="Optional"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Gender</Label>
                    <Select
                      value={companion.gender || ""}
                      onValueChange={(val) => {
                        setCompanions((prev) =>
                          prev.map((c) =>
                            c._id === companion._id
                              ? { ...c, gender: val || null }
                              : c,
                          ),
                        )
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6"
                onClick={() => {
                  setCompanions((prev) =>
                    prev.filter((c) => c._id !== companion._id),
                  )
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex gap-2">
            {!hasSpouse && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCompanions((prev) => [
                    ...prev,
                    {
                      _id: crypto.randomUUID(),
                      name: "",
                      category: "spouse",
                      email: null,
                      gender: null,
                    },
                  ])
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Spouse
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCompanions((prev) => [
                  ...prev,
                  {
                    _id: crypto.randomUUID(),
                    name: "",
                    category: "kid",
                    email: null,
                    gender: null,
                  },
                ])
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Kid
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Custom Fields */}
      {sortedCustomFields.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Custom Fields</CardTitle>
            <CardDescription>
              Additional questions for this popup
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.entries(fieldsBySection).map(([section, fields]) => (
              <div key={section} className="space-y-4">
                {Object.keys(fieldsBySection).length > 1 && (
                  <h4 className="font-medium capitalize">{section}</h4>
                )}
                <div className="space-y-4">
                  {fields.map(([name, field]) =>
                    renderCustomField(name, field),
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/applications" })}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={createMutation.isPending}
          onClick={() => {
            setSavingAsDraft(true)
            form.handleSubmit()
          }}
        >
          Save as Draft
        </Button>
        <LoadingButton
          type="submit"
          loading={createMutation.isPending && !savingAsDraft}
          onClick={() => {
            setSavingAsDraft(false)
            form.handleSubmit()
          }}
        >
          Submit Application
        </LoadingButton>
      </div>
    </div>
  )
}
