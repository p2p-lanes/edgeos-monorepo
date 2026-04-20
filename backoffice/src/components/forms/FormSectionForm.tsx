import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  type FormSectionCreate,
  type FormSectionPublic,
  FormSectionsService,
  type FormSectionUpdate,
  PopupsService,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { FormErrorSummary } from "@/components/Common/FormErrorSummary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { isSpecialSection } from "@/components/form-builder/constants"
import { TranslationManager } from "@/components/translations/TranslationManager"
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
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface FormSectionFormProps {
  defaultValues?: FormSectionPublic
  onSuccess: () => void
}

export function FormSectionForm({
  defaultValues,
  onSuccess,
}: FormSectionFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin
  const isProtectedSection =
    isEdit && defaultValues ? isSpecialSection(defaultValues) : false

  const { data: popupData } = useQuery({
    queryKey: ["popups", defaultValues?.popup_id ?? selectedPopupId],
    queryFn: () =>
      PopupsService.getPopup({
        popupId: defaultValues?.popup_id ?? selectedPopupId!,
      }),
    enabled: isEdit && !!(defaultValues?.popup_id ?? selectedPopupId),
  })

  const createMutation = useMutation({
    mutationFn: (data: FormSectionCreate) =>
      FormSectionsService.createFormSection({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Section created successfully", {
        label: "View",
        onClick: () =>
          navigate({
            to: "/form-builder/sections/$id/edit",
            params: { id: data.id },
          }),
      })
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: FormSectionUpdate) =>
      FormSectionsService.updateFormSection({
        sectionId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Section updated successfully")
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      FormSectionsService.deleteFormSection({
        sectionId: defaultValues!.id,
      }),
    onSuccess: () => {
      showSuccessToast("Section deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      navigate({ to: "/form-builder" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      label: defaultValues?.label ?? "",
      description: defaultValues?.description ?? "",
      order: defaultValues?.order?.toString() ?? "0",
    },
    onSubmit: ({ value }) => {
      if (readOnly) return

      if (isEdit) {
        updateMutation.mutate({
          label: value.label,
          description: value.description || undefined,
          order: Number.parseInt(value.order, 10) || 0,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          label: value.label,
          description: value.description || undefined,
          order: Number.parseInt(value.order, 10) || 0,
        })
      }
    },
  })

  const blocker = useUnsavedChanges(form)

  const isPending = createMutation.isPending || updateMutation.isPending

  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="section" action="create" />
  }

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly) {
            form.handleSubmit()
          }
        }}
        className="space-y-6"
      >
        <FormErrorSummary
          form={form}
          fieldLabels={{
            label: "Label",
            description: "Description",
            order: "Order",
          }}
        />
        <div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {readOnly
                    ? "Section Details"
                    : isEdit
                      ? "Edit Section"
                      : "New Section"}
                </CardTitle>
                <CardDescription>
                  {isProtectedSection
                    ? "This is a protected section; you can edit title, description and order. It cannot be deleted."
                    : readOnly
                      ? "View section configuration (read-only)"
                      : isEdit
                        ? "Update the section configuration"
                        : "Create a new section to group form fields"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
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
                          Label{" "}
                          {!readOnly && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <Input
                          id="label"
                          placeholder="Preferences"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={readOnly}
                        />
                        <p className="text-sm text-muted-foreground">
                          Section title shown to applicants
                        </p>
                        <FieldError errors={field.state.meta.errors} />
                      </div>
                    )}
                  </form.Field>

                  <form.Field name="order">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="order">Order</Label>
                        <Input
                          id="order"
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
                </div>

                <form.Field name="description">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="A brief description for this section..."
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={readOnly}
                      />
                      <p className="text-sm text-muted-foreground">
                        Optional subtitle shown below the section title
                      </p>
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {isEdit && (popupData?.supported_languages?.length ?? 0) > 1 && (
              <>
                <Separator />
                <TranslationManager
                  entityType="form_section"
                  entityId={defaultValues!.id}
                  translatableFields={["label", "description"]}
                  sourceData={{
                    label: defaultValues!.label,
                    description: defaultValues!.description,
                  }}
                  supportedLanguages={popupData!.supported_languages!}
                  defaultLanguage={popupData!.default_language!}
                />
              </>
            )}

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
                  {isEdit ? "Save Changes" : "Create Section"}
                </LoadingButton>
              )}
            </div>
          </div>
        </div>
      </form>

      {isEdit && !readOnly && !isProtectedSection && (
        <DangerZone
          description="Once you delete this section, all fields assigned to it will become unsectioned. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Section"
          resourceName={defaultValues.label}
        />
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
