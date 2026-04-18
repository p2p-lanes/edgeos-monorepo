import {
  closestCenter,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Loader2, Sparkles } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import {
  type FormFieldPublic,
  FormFieldsService,
  type FormFieldUpdate,
  FormSectionsService,
  type FormSectionUpdate,
} from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import {
  canRemoveField,
  FIELD_TYPES,
  isSpecialField,
  PALETTE_ITEM_PREFIX,
  parseSortableSectionId,
  SORTABLE_SECTION_PREFIX,
} from "@/components/form-builder/constants"
import { CatalogDialog } from "@/components/form-builder/CatalogDialog"
import { DragOverlayContent } from "@/components/form-builder/DragOverlayContent"
import { FieldConfigPanel } from "@/components/form-builder/FieldConfigPanel"
import { FieldPalette } from "@/components/form-builder/FieldPalette"
import { FormCanvas } from "@/components/form-builder/FormCanvas"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/form-builder/")({
  component: FormBuilderPage,
  head: () => ({
    meta: [{ title: "Form Builder - EdgeOS" }],
  }),
})

const UNSECTIONED = "__unsectioned__"

function getAllFormFieldsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      FormFieldsService.listFormFields({
        popupId: popupId || undefined,
        limit: 200,
      }),
    queryKey: ["form-fields", popupId, "all"],
  }
}

function getAllFormSectionsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      FormSectionsService.listFormSections({
        popupId: popupId || undefined,
        limit: 200,
      }),
    queryKey: ["form-sections", popupId, "all"],
  }
}

function FormBuilderPage() {
  const { isAdmin } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()

  if (!isContextReady) {
    return (
      <div className="flex flex-col gap-6">
        <WorkspaceAlert resource="form builder" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Form Builder</h1>
        <p className="text-muted-foreground">
          You need admin permissions to use the form builder.
        </p>
      </div>
    )
  }

  return <FormBuilderContent popupId={selectedPopupId!} />
}

function FormBuilderContent({ popupId }: { popupId: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FormFieldPublic | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [liveOrderMap, setLiveOrderMap] = useState<Record<
    string,
    string[]
  > | null>(null)
  const [liveSectionOrder, setLiveSectionOrder] = useState<string[] | null>(
    null,
  )

  const { data: formFieldsData, isLoading: isLoadingFields } = useQuery({
    ...getAllFormFieldsQueryOptions(popupId),
  })

  const { data: formSectionsData, isLoading: isLoadingSections } = useQuery({
    ...getAllFormSectionsQueryOptions(popupId),
  })

  const isLoading = isLoadingFields || isLoadingSections

  const fields = useMemo(() => {
    if (!formFieldsData?.results) return []
    return formFieldsData.results
  }, [formFieldsData])

  const sections = useMemo(() => {
    if (!formSectionsData?.results) return []
    return [...formSectionsData.results].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    )
  }, [formSectionsData])

  const fieldsBySection = useMemo(() => {
    const serverMap: Record<string, FormFieldPublic[]> = {}

    for (const section of sections) {
      serverMap[section.id] = []
    }

    const hasUnsectioned = fields.some((f) => !f.section_id)
    if (hasUnsectioned) {
      serverMap[UNSECTIONED] = []
    }

    for (const field of fields) {
      const key = field.section_id || UNSECTIONED
      if (!serverMap[key]) serverMap[key] = []
      serverMap[key].push(field)
    }

    for (const sectionFields of Object.values(serverMap)) {
      sectionFields.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    }

    if (!liveOrderMap) return serverMap

    const resolved: Record<string, FormFieldPublic[]> = { ...serverMap }
    for (const [sectionKey, orderedIds] of Object.entries(liveOrderMap)) {
      const allSectionFields = fields.filter((f) => orderedIds.includes(f.id))
      resolved[sectionKey] = orderedIds
        .map((id) => allSectionFields.find((f) => f.id === id))
        .filter(Boolean) as FormFieldPublic[]
    }
    return resolved
  }, [fields, sections, liveOrderMap])

  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // --- Field mutations ---

  const createFieldMutation = useMutation({
    mutationFn: (data: {
      fieldType: string
      sectionId: string | null
      position: number
    }) => {
      const typeDef = FIELD_TYPES.find((t) => t.value === data.fieldType)
      const label = `New ${typeDef?.label || data.fieldType} field`
      return FormFieldsService.createFormField({
        requestBody: {
          popup_id: popupId,
          label,
          field_type: data.fieldType,
          section_id: data.sectionId,
          position: data.position,
          required: false,
        },
      })
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
      setSelectedFieldId(created.id)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateFieldMutation = useMutation({
    mutationFn: (data: { fieldId: string; requestBody: FormFieldUpdate }) =>
      FormFieldsService.updateFormField(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteFieldMutation = useMutation({
    mutationFn: (fieldId: string) =>
      FormFieldsService.deleteFormField({ fieldId }),
    onSuccess: () => {
      showSuccessToast("Field deleted")
      if (deleteTarget?.id === selectedFieldId) {
        setSelectedFieldId(null)
      }
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  // --- Section mutations ---

  const createSectionMutation = useMutation({
    mutationFn: (label: string) =>
      FormSectionsService.createFormSection({
        requestBody: {
          popup_id: popupId,
          label,
          order: sections.length,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateSectionMutation = useMutation({
    mutationFn: (data: { sectionId: string; requestBody: FormSectionUpdate }) =>
      FormSectionsService.updateFormSection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteSectionMutation = useMutation({
    mutationFn: (sectionId: string) =>
      FormSectionsService.deleteFormSection({ sectionId }),
    onSuccess: () => {
      showSuccessToast("Section deleted")
      queryClient.invalidateQueries({ queryKey: ["form-sections"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  // --- Reorder helpers ---

  const persistReorder = useCallback(
    (reorderedFields: FormFieldPublic[], targetSectionId: string | null) => {
      for (let i = 0; i < reorderedFields.length; i++) {
        const field = reorderedFields[i]
        const updates: FormFieldUpdate = {}
        if (field.position !== i) updates.position = i
        if (field.section_id !== targetSectionId)
          updates.section_id = targetSectionId
        if (Object.keys(updates).length > 0) {
          updateFieldMutation.mutate({
            fieldId: field.id,
            requestBody: updates,
          })
        }
      }
    },
    [updateFieldMutation],
  )

  const sectionKeys = useMemo(() => {
    const keys = sections.map((s) => s.id)
    if (fieldsBySection[UNSECTIONED]?.length) {
      keys.unshift(UNSECTIONED)
    }
    return keys
  }, [sections, fieldsBySection])

  const orderedSectionKeys = useMemo(() => {
    if (liveSectionOrder === null) return sectionKeys
    const hasUnsectioned = fieldsBySection[UNSECTIONED]?.length
    const apiOrder = liveSectionOrder.filter((id) =>
      sections.some((s) => s.id === id),
    )
    return hasUnsectioned ? [UNSECTIONED, ...apiOrder] : apiOrder
  }, [liveSectionOrder, sectionKeys, sections, fieldsBySection])

  const buildInitialLiveMap = useCallback((): Record<string, string[]> => {
    const map: Record<string, string[]> = {}
    for (const key of sectionKeys) {
      const sectionFields = fields
        .filter((f) => (f.section_id || UNSECTIONED) === key)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      map[key] = sectionFields.map((f) => f.id)
    }
    return map
  }, [fields, sectionKeys])

  // --- DnD handlers ---

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id)
    const activeIdStr = String(event.active.id)
    if (activeIdStr.startsWith(SORTABLE_SECTION_PREFIX)) {
      setLiveSectionOrder(sections.map((s) => s.id))
      return
    }
    if (!activeIdStr.startsWith(PALETTE_ITEM_PREFIX)) {
      setLiveOrderMap(buildInitialLiveMap())
    }
  }

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over || !active) return

      const activeIdStr = String(active.id)
      if (activeIdStr.startsWith(SORTABLE_SECTION_PREFIX)) {
        if (
          over.data.current?.type === "section-sortable" &&
          liveSectionOrder
        ) {
          const overSectionId = over.data.current.sectionId as string
          const activeSectionId = parseSortableSectionId(activeIdStr)
          if (!activeSectionId || activeSectionId === overSectionId) return
          setLiveSectionOrder((prev) => {
            if (!prev) return prev
            const oldIndex = prev.indexOf(activeSectionId)
            const newIndex = prev.indexOf(overSectionId)
            if (oldIndex === -1 || newIndex === -1) return prev
            return arrayMove(prev, oldIndex, newIndex)
          })
        }
        return
      }
      if (activeIdStr.startsWith(PALETTE_ITEM_PREFIX)) return

      let targetKey: string
      if (over.data.current?.type === "section") {
        targetKey = over.data.current.sectionKey
      } else if (over.data.current?.type === "canvas-field") {
        targetKey = over.data.current.sectionKey || UNSECTIONED
      } else {
        return
      }

      setLiveOrderMap((prev) => {
        if (!prev) return prev

        let activeSection: string | null = null
        for (const [section, ids] of Object.entries(prev)) {
          if (ids.includes(activeIdStr)) {
            activeSection = section
            break
          }
        }
        if (!activeSection) return prev

        const sourceIds = [...(prev[activeSection] ?? [])]
        const targetIds = [...(prev[targetKey] ?? [])]

        if (activeSection === targetKey) return prev

        const newSourceIds = sourceIds.filter((id) => id !== activeIdStr)
        const newTargetIds = targetIds.filter((id) => id !== activeIdStr)
        const overIdStr = String(over.id)
        const insertIndex = newTargetIds.indexOf(overIdStr)
        if (insertIndex === -1) {
          newTargetIds.push(activeIdStr)
        } else {
          newTargetIds.splice(insertIndex, 0, activeIdStr)
        }
        return {
          ...prev,
          [activeSection]: newSourceIds,
          [targetKey]: newTargetIds,
        }
      })
    },
    [liveSectionOrder],
  )

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveId(null)
    setLiveOrderMap(null)
    setLiveSectionOrder(null)
  }, [])

  const persistSectionOrder = useCallback(
    (sectionIds: string[]) => {
      const previousOrder = sections
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => s.id)
      sectionIds.forEach((sectionId, index) => {
        if (previousOrder[index] !== sectionId) {
          updateSectionMutation.mutate({
            sectionId,
            requestBody: { order: index },
          })
        }
      })
    },
    [sections, updateSectionMutation],
  )

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    const activeIdStr = String(active.id)

    if (activeIdStr.startsWith(SORTABLE_SECTION_PREFIX)) {
      if (liveSectionOrder) persistSectionOrder(liveSectionOrder)
      setLiveSectionOrder(null)
      return
    }

    if (activeIdStr.startsWith(PALETTE_ITEM_PREFIX)) {
      setLiveOrderMap(null)
      if (!over) return
      const fieldType = activeIdStr.replace(PALETTE_ITEM_PREFIX, "")
      let targetKey = sections.length > 0 ? sections[0].id : UNSECTIONED

      if (over.data.current?.type === "section") {
        targetKey = over.data.current.sectionKey
      } else if (over.data.current?.type === "canvas-field") {
        targetKey = over.data.current.sectionKey || UNSECTIONED
      }

      const sectionId = targetKey === UNSECTIONED ? null : targetKey
      const sectionFields = fields.filter(
        (f) => (f.section_id || UNSECTIONED) === targetKey,
      )
      createFieldMutation.mutate({
        fieldType,
        sectionId,
        position: sectionFields.length,
      })
      return
    }

    let finalOrderMap = liveOrderMap ? { ...liveOrderMap } : null

    // Apply same-section arrayMove — was intentionally skipped in handleDragOver
    if (finalOrderMap && over) {
      const overIdStr = String(over.id)

      let activeSection: string | null = null
      for (const [section, ids] of Object.entries(finalOrderMap)) {
        if (ids.includes(activeIdStr)) {
          activeSection = section
          break
        }
      }

      let targetKey: string | null = null
      if (over.data.current?.type === "canvas-field") {
        targetKey = over.data.current.sectionKey || UNSECTIONED
      } else if (over.data.current?.type === "section") {
        targetKey = over.data.current.sectionKey
      }

      if (
        activeSection &&
        targetKey &&
        activeSection === targetKey &&
        over.data.current?.type === "canvas-field"
      ) {
        const sourceIds = [...finalOrderMap[activeSection]]
        const oldIndex = sourceIds.indexOf(activeIdStr)
        const newIndex = sourceIds.indexOf(overIdStr)
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          finalOrderMap = {
            ...finalOrderMap,
            [activeSection]: arrayMove(sourceIds, oldIndex, newIndex),
          }
        }
      }
    }

    if (finalOrderMap) {
      for (const [sectionKey, orderedIds] of Object.entries(finalOrderMap)) {
        const serverOrder = fields
          .filter((f) => (f.section_id || UNSECTIONED) === sectionKey)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((f) => f.id)
        const hasChanged =
          orderedIds.length !== serverOrder.length ||
          orderedIds.some((id, i) => id !== serverOrder[i])
        if (!hasChanged) continue

        const resolvedFields = orderedIds
          .map((id) => fields.find((f) => f.id === id))
          .filter(Boolean) as FormFieldPublic[]
        const sectionId = sectionKey === UNSECTIONED ? null : sectionKey
        persistReorder(resolvedFields, sectionId)
      }
    }
    setLiveOrderMap(null)
  }

  // --- Callbacks ---

  const handleSelectField = useCallback((fieldId: string) => {
    setSelectedFieldId((prev) => (prev === fieldId ? null : fieldId))
  }, [])

  const handleDeleteField = useCallback(
    (fieldId: string) => {
      const field = fields.find((f) => f.id === fieldId)
      if (!field) return
      if (!canRemoveField(field)) {
        showErrorToast("This field cannot be removed.")
        return
      }
      setDeleteTarget(field)
    },
    [fields, showErrorToast],
  )

  const handleUpdateSection = useCallback(
    (sectionId: string, updates: FormSectionUpdate) => {
      updateSectionMutation.mutate({ sectionId, requestBody: updates })
    },
    [updateSectionMutation],
  )

  const handleDeleteSection = useCallback(
    (sectionId: string) => {
      deleteSectionMutation.mutate(sectionId)
    },
    [deleteSectionMutation],
  )

  const handleAddSection = useCallback(
    (label: string) => {
      createSectionMutation.mutate(label)
    },
    [createSectionMutation],
  )

  const handleFieldUpdated = useCallback(
    (_updated: FormFieldPublic) => {
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    [queryClient],
  )

  const collisionDetection = useCallback(
    (args: Parameters<typeof pointerWithin>[0]) => {
      const activeIdStr = String(args.active.id)
      if (activeIdStr.startsWith(PALETTE_ITEM_PREFIX)) {
        return pointerWithin(args)
      }
      return closestCenter(args)
    },
    [],
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form Builder</h1>
          <p className="text-muted-foreground">
            Configure custom fields for application forms
          </p>
        </div>
        <Skeleton className="h-[calc(100vh-200px)] w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form Builder</h1>
          <p className="text-muted-foreground">
            Drag fields from the palette to build your application form
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCatalogOpen(true)}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Add predefined fields
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 min-h-0 rounded-lg border">
          <div className="flex-1 overflow-y-auto">
            <FormCanvas
              fieldsBySection={fieldsBySection}
              sections={sections}
              orderedSectionKeys={orderedSectionKeys}
              selectedFieldId={selectedFieldId}
              onSelectField={handleSelectField}
              onDeleteField={handleDeleteField}
              onUpdateSection={handleUpdateSection}
              onDeleteSection={handleDeleteSection}
              onAddSection={handleAddSection}
            />
          </div>
          <div className="w-[280px] shrink-0 border-l bg-muted/30">
            <FieldPalette />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          <DragOverlayContent
            activeId={activeId ? String(activeId) : null}
            fields={fields}
            sections={sections}
          />
        </DragOverlay>
      </DndContext>

      <Sheet
        open={!!selectedFieldId}
        onOpenChange={(open) => {
          if (!open) setSelectedFieldId(null)
        }}
      >
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Field Settings</SheetTitle>
            <SheetDescription>
              Configure the selected field properties
            </SheetDescription>
          </SheetHeader>
          {selectedField && (
            <FieldConfigPanel
              field={selectedField}
              onClose={() => setSelectedFieldId(null)}
              onFieldUpdated={handleFieldUpdated}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget && isSpecialField(deleteTarget)
                ? "Remove from this popup"
                : "Delete Form Field"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && isSpecialField(deleteTarget)
                ? `"${deleteTarget.label}" will no longer be asked on this popup. The field stays in the catalog and can be added back later.`
                : `Are you sure you want to delete "${deleteTarget?.label}"? Applications may lose their stored data for this field. This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={deleteFieldMutation.isPending}
              onClick={() =>
                deleteTarget && deleteFieldMutation.mutate(deleteTarget.id)
              }
            >
              {deleteTarget && isSpecialField(deleteTarget)
                ? "Remove"
                : "Delete"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(createFieldMutation.isPending ||
        updateFieldMutation.isPending ||
        createSectionMutation.isPending ||
        updateSectionMutation.isPending) && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      )}

      <CatalogDialog
        popupId={popupId}
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
      />
    </div>
  )
}
