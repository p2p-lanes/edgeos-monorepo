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
  /** Raw JSON text the admin edits; parsed on save. */
  requiredFieldsJson: string
  requiredFieldsError: string | null
}

const EMPTY_DIALOG: DialogState = {
  open: false,
  editing: null,
  key: "",
  label: "",
  sortOrder: "",
  enabledInPassesFlow: true,
  maxPerApplication: "",
  requiredFieldsJson: "[]",
  requiredFieldsError: null,
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

  // Parse the JSON the admin typed; null on parse error or non-array.
  const parseRequiredFields = (): Array<Record<string, unknown>> | null => {
    try {
      const trimmed = state.requiredFieldsJson.trim()
      if (trimmed === "") return []
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return null
      // Coerce: every entry must be a plain object — schema is `[{...}]` only.
      return parsed.every((it) => it && typeof it === "object")
        ? (parsed as Array<Record<string, unknown>>)
        : null
    } catch {
      return null
    }
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const fields = parseRequiredFields()
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
          required_fields: fields ?? undefined,
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
      const fields = parseRequiredFields()
      return AttendeeCategoriesService.updateAttendeeCategory({
        categoryId: state.editing!.id,
        requestBody: {
          sort_order: state.sortOrder !== "" ? Number(state.sortOrder) : null,
          enabled_in_passes_flow: state.enabledInPassesFlow,
          max_per_application:
            state.maxPerApplication !== ""
              ? Number(state.maxPerApplication)
              : null,
          required_fields: fields ?? undefined,
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
    const fields = Array.isArray(cat.required_fields) ? cat.required_fields : []
    setState({
      open: true,
      editing: cat,
      key: cat.key,
      label: (meta?.label as string) ?? "",
      sortOrder: cat.sort_order != null ? String(cat.sort_order) : "",
      enabledInPassesFlow: cat.enabled_in_passes_flow ?? true,
      maxPerApplication:
        cat.max_per_application != null ? String(cat.max_per_application) : "",
      requiredFieldsJson: JSON.stringify(fields, null, 2),
      requiredFieldsError: null,
    })
  }

  const save = () => {
    if (!state.key.trim() && !state.editing) {
      showErrorToast("Key is required")
      return
    }
    // Validate required_fields JSON before firing the mutation so the admin
    // gets an inline error instead of a confusing 422 from the server.
    if (state.requiredFieldsJson.trim() !== "") {
      const fields = parseRequiredFields()
      if (fields === null) {
        setState((prev) => ({
          ...prev,
          requiredFieldsError: "Invalid JSON — must be an array",
        }))
        return
      }
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

            <div className="space-y-1.5">
              <Label htmlFor="cat-required-fields">
                Required fields (JSON)
              </Label>
              <textarea
                id="cat-required-fields"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={state.requiredFieldsJson}
                spellCheck={false}
                placeholder='[{"name":"age","label":"Age","type":"select","required":true,"options":[{"value":"1","label":"1 year old"},{"value":"2","label":"2 years old"}]}]'
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    requiredFieldsJson: e.target.value,
                    requiredFieldsError: null,
                  }))
                }
              />
              {state.requiredFieldsError && (
                <p className="text-xs text-destructive">
                  {state.requiredFieldsError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Schema for extra fields shown in the portal modal. Each item:{" "}
                {`{name, label?, type, required?, options?, display_as_subtitle?}`}
                . Options accept strings or {`{value,label}`} pairs.
              </p>
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
