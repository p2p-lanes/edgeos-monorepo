import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react"
import { useState } from "react"

import {
  type VenuePropertyTypePublic,
  VenuePropertyTypesService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { LucideIconPicker } from "@/components/LucideIconPicker"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { LucideIcon } from "@/lib/lucide-icon"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/events/properties")({
  component: VenuePropertiesPage,
  head: () => ({
    meta: [{ title: "Venue Properties - EdgeOS" }],
  }),
})

function VenuePropertiesPage() {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { effectiveTenantId } = useWorkspace()

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("")

  const [editing, setEditing] = useState<VenuePropertyTypePublic | null>(null)
  const [editName, setEditName] = useState("")
  const [editIcon, setEditIcon] = useState("")

  const [pendingDelete, setPendingDelete] =
    useState<VenuePropertyTypePublic | null>(null)

  const { data: propertyTypes, isLoading } = useQuery<
    VenuePropertyTypePublic[]
  >({
    queryKey: ["venue-property-types"],
    queryFn: () => VenuePropertyTypesService.listPropertyTypes(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      VenuePropertyTypesService.createPropertyType({
        xTenantId: effectiveTenantId ?? "",
        requestBody: { name: newName.trim(), icon: newIcon.trim() || null },
      }),
    onSuccess: () => {
      showSuccessToast("Property type created")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      setNewName("")
      setNewIcon("")
      setShowNew(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("nothing to update")
      return VenuePropertyTypesService.updatePropertyType({
        propertyTypeId: editing.id,
        xTenantId: effectiveTenantId ?? null,
        requestBody: {
          name: editName.trim() || null,
          icon: editIcon.trim() || null,
        },
      })
    },
    onSuccess: () => {
      showSuccessToast("Property type updated")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      setEditing(null)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (propertyTypeId: string) =>
      VenuePropertyTypesService.deletePropertyType({ propertyTypeId }),
    onSuccess: () => {
      showSuccessToast("Property type deleted")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      setPendingDelete(null)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const startEdit = (pt: VenuePropertyTypePublic) => {
    setEditing(pt)
    setEditName(pt.name)
    setEditIcon(pt.icon ?? "")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Venue Properties
          </h1>
          <p className="text-muted-foreground">
            Catalog of properties you can attach to venues (projector, Wi-Fi,
            chairs…). Edits here are shared by every venue that references the
            property.
          </p>
        </div>
        {!showNew && (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New property
          </Button>
        )}
      </div>

      {showNew && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label htmlFor="new-prop-name">Name</Label>
            <Input
              id="new-prop-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Projector, Wi-Fi, Parking..."
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Icon (optional)</Label>
            <LucideIconPicker
              value={newIcon || null}
              onChange={(v) => setNewIcon(v ?? "")}
              seed={newName}
            />
          </div>
          <div className="flex gap-2">
            <LoadingButton
              loading={createMutation.isPending}
              disabled={!newName.trim()}
              onClick={() => createMutation.mutate()}
            >
              Create
            </LoadingButton>
            <Button
              variant="ghost"
              onClick={() => {
                setShowNew(false)
                setNewName("")
                setNewIcon("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : propertyTypes && propertyTypes.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {propertyTypes.map((pt) => {
            const isEditing = editing?.id === pt.id
            return (
              <li
                key={pt.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                {isEditing ? (
                  <>
                    <LucideIconPicker
                      value={editIcon || null}
                      onChange={(v) => setEditIcon(v ?? "")}
                      seed={editName}
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="max-w-xs"
                      autoFocus
                    />
                    <div className="ml-auto flex gap-1">
                      <LoadingButton
                        size="sm"
                        loading={updateMutation.isPending}
                        disabled={!editName.trim()}
                        onClick={() => updateMutation.mutate()}
                      >
                        <Check className="h-4 w-4" />
                      </LoadingButton>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
                      <LucideIcon name={pt.icon} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{pt.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Icon: {pt.icon || "—"}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${pt.name}`}
                        onClick={() => startEdit(pt)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${pt.name}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(pt)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No properties yet"
          description="Create the first property type to start tagging venues."
        />
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete property type</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Remove "${pendingDelete.name}" from the catalog? Every venue referencing this property will lose it. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete.id)
              }
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
