import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import {
  AttendeeCategoriesService,
  type AttendeeCategoryPublic,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface AttendeeCategoriesEditorProps {
  popupId: string
  readOnly?: boolean
}

interface DialogState {
  open: boolean
  editing: AttendeeCategoryPublic | null
  key: string
  label: string
  sortOrder: string
  enabledInPassesFlow: boolean
  /** Empty string = unlimited (null on the server). */
  maxPerApplication: string
  // High-level form fields the admin toggles. We serialize/deserialize these
  // to/from the underlying `required_fields` JSONB so the dialog stays simple
  // for the cases we actually have: spouse (email+gender), kid (age group).
  requireEmail: boolean
  requireGender: boolean
  askAgeGroup: boolean
}

const EMPTY_DIALOG: DialogState = {
  open: false,
  editing: null,
  key: "",
  label: "",
  sortOrder: "",
  enabledInPassesFlow: true,
  maxPerApplication: "",
  requireEmail: true,
  requireGender: false,
  askAgeGroup: false,
}

interface RequiredFieldOption {
  value: string
  label: string
}

interface RequiredFieldEntry {
  name: string
  label?: string
  type: "text" | "email" | "number" | "select"
  required?: boolean
  options?: Array<string | RequiredFieldOption>
  display_as_subtitle?: boolean
}

const AGE_GROUP_OPTIONS: RequiredFieldOption[] = [
  { value: "baby", label: "Baby" },
  { value: "kid", label: "Kid" },
  { value: "teen", label: "Teen" },
]

function serializeRequiredFields(
  state: Pick<DialogState, "requireEmail" | "requireGender" | "askAgeGroup">,
): RequiredFieldEntry[] {
  const fields: RequiredFieldEntry[] = []
  if (state.requireEmail) {
    fields.push({
      name: "email",
      label: "Email",
      type: "email",
      required: true,
    })
  }
  if (state.requireGender) {
    fields.push({
      name: "gender",
      label: "Gender",
      type: "select",
      required: true,
      options: [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "non_binary", label: "Non-binary" },
        { value: "prefer_not_to_say", label: "Prefer not to say" },
      ],
    })
  }
  if (state.askAgeGroup) {
    fields.push({
      name: "age_group",
      label: "Age group",
      type: "select",
      required: true,
      options: AGE_GROUP_OPTIONS,
      display_as_subtitle: true,
    })
  }
  return fields
}

function deserializeRequiredFields(
  raw: unknown,
): Pick<DialogState, "requireEmail" | "requireGender" | "askAgeGroup"> {
  const fields: RequiredFieldEntry[] = Array.isArray(raw)
    ? (raw as RequiredFieldEntry[])
    : []
  const hasEmail = fields.some((f) => f?.name === "email")
  const hasGender = fields.some((f) => f?.name === "gender")
  // Recognize both age_group and the legacy numeric `age` field so existing
  // "kid" categories show the toggle as on until re-saved.
  const hasAgeGroup = fields.some(
    (f) => f?.name === "age_group" || f?.name === "age",
  )
  return {
    requireEmail: hasEmail,
    requireGender: hasGender,
    askAgeGroup: hasAgeGroup,
  }
}

function resolveCategoryLabel(category: AttendeeCategoryPublic): string {
  const meta = category.display_meta as Record<string, unknown> | undefined
  const metaLabel = meta?.label
  if (metaLabel && typeof metaLabel === "string" && metaLabel.trim() !== "") {
    return metaLabel
  }
  return category.key.charAt(0).toUpperCase() + category.key.slice(1)
}

export function AttendeeCategoriesEditor({
  popupId,
  readOnly = false,
}: AttendeeCategoriesEditorProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [state, setState] = useState<DialogState>(EMPTY_DIALOG)

  const queryKey = ["attendee-categories", popupId]

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await AttendeeCategoriesService.listAttendeeCategories({
        popupId,
      })
      const list = Array.isArray(result?.results) ? result.results : []
      return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    },
    enabled: !!popupId,
    staleTime: 0,
    refetchOnMount: "always",
  })
  // Defensive: a stale persisted cache or unexpected response shape could yield
  // a non-array `data`; treat anything that isn't an array as empty.
  const categories: AttendeeCategoryPublic[] = Array.isArray(data) ? data : []

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation({
    mutationFn: () => {
      const fields = serializeRequiredFields(state)
      return AttendeeCategoriesService.createAttendeeCategory({
        requestBody: {
          popup_id: popupId,
          key: state.key.trim(),
          sort_order:
            state.sortOrder !== "" ? Number(state.sortOrder) : undefined,
          enabled_in_passes_flow: state.enabledInPassesFlow,
          max_per_application:
            state.maxPerApplication !== ""
              ? Number(state.maxPerApplication)
              : undefined,
          required_fields: fields as unknown as Array<{
            [key: string]: unknown
          }>,
          display_meta:
            state.label.trim() !== ""
              ? { label: state.label.trim() }
              : undefined,
        },
      })
    },
    onSuccess: () => {
      showSuccessToast("Category created")
      invalidate()
      setState(EMPTY_DIALOG)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      const fields = serializeRequiredFields(state)
      return AttendeeCategoriesService.updateAttendeeCategory({
        categoryId: state.editing!.id,
        requestBody: {
          sort_order: state.sortOrder !== "" ? Number(state.sortOrder) : null,
          enabled_in_passes_flow: state.enabledInPassesFlow,
          max_per_application:
            state.maxPerApplication !== ""
              ? Number(state.maxPerApplication)
              : null,
          required_fields: fields as unknown as Array<{
            [key: string]: unknown
          }>,
          display_meta: { label: state.label.trim() || state.editing!.key },
        },
      })
    },
    onSuccess: () => {
      showSuccessToast("Category updated")
      invalidate()
      setState(EMPTY_DIALOG)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) =>
      AttendeeCategoriesService.deleteAttendeeCategory({ categoryId }),
    onSuccess: () => {
      showSuccessToast("Category removed")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const openAdd = () => setState({ ...EMPTY_DIALOG, open: true })

  const openEdit = (cat: AttendeeCategoryPublic) => {
    const meta = cat.display_meta as Record<string, unknown> | undefined
    const fieldsState = deserializeRequiredFields(cat.required_fields)
    setState({
      open: true,
      editing: cat,
      key: cat.key,
      label: (meta?.label as string) ?? "",
      sortOrder: cat.sort_order != null ? String(cat.sort_order) : "",
      enabledInPassesFlow: cat.enabled_in_passes_flow ?? true,
      maxPerApplication:
        cat.max_per_application != null ? String(cat.max_per_application) : "",
      ...fieldsState,
    })
  }

  const save = () => {
    if (!state.key.trim() && !state.editing) {
      showErrorToast("Key is required")
      return
    }
    if (
      state.maxPerApplication !== "" &&
      (!Number.isInteger(Number(state.maxPerApplication)) ||
        Number(state.maxPerApplication) < 1)
    ) {
      showErrorToast("Max per application must be a positive integer or empty")
      return
    }
    if (state.editing) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending

  return (
    <InlineSection title="Companion types">
      <div className="space-y-2 py-3">
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companion types configured. Add one to allow attendees to bring
            companions.
          </p>
        ) : (
          <ul className="space-y-2">
            {categories.map((cat) => {
              const label = resolveCategoryLabel(cat)
              return (
                <li
                  key={cat.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        {cat.is_primary && (
                          <Badge variant="secondary">Primary</Badge>
                        )}
                        {!cat.enabled_in_passes_flow && (
                          <Badge variant="outline">Hidden</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        key: {cat.key}
                        {cat.sort_order != null &&
                          ` · order: ${cat.sort_order}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${label}`}
                      onClick={() => openEdit(cat)}
                      disabled={readOnly}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${label}`}
                      onClick={() => deleteMutation.mutate(cat.id)}
                      disabled={
                        readOnly || cat.is_primary || deleteMutation.isPending
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {!readOnly && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add category
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={state.open}
        onOpenChange={(open) =>
          setState((prev) => ({ ...prev, open: open ? prev.open : false }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {state.editing ? "Edit companion type" : "New companion type"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!state.editing && (
              <div className="space-y-1.5">
                <Label htmlFor="cat-key">Key</Label>
                <Input
                  id="cat-key"
                  value={state.key}
                  placeholder="e.g. spouse, kid, teen"
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, key: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase identifier, cannot be changed after creation.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cat-label">Display label</Label>
              <Input
                id="cat-label"
                value={state.label}
                placeholder={state.key || "Label shown in portal"}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, label: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-order">Sort order</Label>
              <Input
                id="cat-order"
                type="number"
                min="0"
                value={state.sortOrder}
                placeholder="0"
                onChange={(e) =>
                  setState((prev) => ({ ...prev, sortOrder: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="cat-enabled">Visible in passes flow</Label>
              <Switch
                id="cat-enabled"
                checked={state.enabledInPassesFlow}
                onCheckedChange={(checked) =>
                  setState((prev) => ({
                    ...prev,
                    enabledInPassesFlow: checked,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-max">Max per application</Label>
              <Input
                id="cat-max"
                type="number"
                min="1"
                value={state.maxPerApplication}
                placeholder="Unlimited"
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    maxPerApplication: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                How many attendees of this type a single applicant can add.
                Leave empty for unlimited.
              </p>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Required fields</p>
              <p className="text-xs text-muted-foreground">
                Extra fields shown when adding this attendee in the portal. Name
                is always required.
              </p>

              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="cat-require-email">Require email</Label>
                <Switch
                  id="cat-require-email"
                  checked={state.requireEmail}
                  onCheckedChange={(checked) =>
                    setState((prev) => ({ ...prev, requireEmail: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="cat-require-gender">Require gender</Label>
                <Switch
                  id="cat-require-gender"
                  checked={state.requireGender}
                  onCheckedChange={(checked) =>
                    setState((prev) => ({ ...prev, requireGender: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="cat-ask-age-group">Ask for age group</Label>
                <Switch
                  id="cat-ask-age-group"
                  checked={state.askAgeGroup}
                  onCheckedChange={(checked) =>
                    setState((prev) => ({ ...prev, askAgeGroup: checked }))
                  }
                />
              </div>
              {state.askAgeGroup && (
                <p className="pl-2 text-xs text-muted-foreground">
                  Adds an age-group field (baby / kid / teen) shown when adding
                  this attendee in the portal.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setState(EMPTY_DIALOG)}
            >
              Cancel
            </Button>
            <LoadingButton type="button" loading={saving} onClick={save}>
              {state.editing ? "Save" : "Create"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InlineSection>
  )
}
