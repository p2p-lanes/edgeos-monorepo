import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HelpCircle, Plus, X } from "lucide-react"
import { useState } from "react"

import {
  type VenuePropertyTypePublic,
  VenuePropertyTypesService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InlineSection } from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { resolveLucideIcon } from "@/lib/lucide-icon-map"
import { createErrorHandler } from "@/utils"

function LucideIconByName({
  name,
  className,
}: {
  name: string | null | undefined
  className?: string
}) {
  const Icon = resolveLucideIcon(name)
  if (!Icon) return null
  return <Icon className={className} />
}

interface PropertyPickerProps {
  value: string[]
  onChange: (ids: string[]) => void
}

export function PropertyPicker({ value, onChange }: PropertyPickerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { selectedTenantId } = useWorkspace()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("")
  const [pendingDelete, setPendingDelete] =
    useState<VenuePropertyTypePublic | null>(null)

  const { data: propertyTypes = [] } = useQuery<VenuePropertyTypePublic[]>({
    queryKey: ["venue-property-types"],
    queryFn: () => VenuePropertyTypesService.listPropertyTypes(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      VenuePropertyTypesService.createPropertyType({
        xTenantId: selectedTenantId ?? "",
        requestBody: { name: newName.trim(), icon: newIcon.trim() || null },
      }),
    onSuccess: (created) => {
      showSuccessToast("Property type created")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      if (created?.id) onChange([...value, created.id])
      setNewName("")
      setNewIcon("")
      setShowNew(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (propertyTypeId: string) =>
      VenuePropertyTypesService.deletePropertyType({ propertyTypeId }),
    onSuccess: (_, propertyTypeId) => {
      showSuccessToast("Property type deleted")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      onChange(value.filter((v) => v !== propertyTypeId))
      setPendingDelete(null)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <InlineSection title="Properties">
      <div className="space-y-3 py-3">
        {propertyTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No property types yet. Create one below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {propertyTypes.map((pt) => {
              const selected = value.includes(pt.id)
              return (
                <div key={pt.id} className="group relative w-24">
                  <button
                    type="button"
                    onClick={() => toggle(pt.id)}
                    aria-pressed={selected}
                    className={
                      "flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (selected
                        ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                        : "bg-card text-foreground hover:bg-muted/50")
                    }
                  >
                    <LucideIconByName
                      name={pt.icon}
                      className="h-6 w-6 shrink-0"
                    />
                    <span className="line-clamp-2 break-all text-center">
                      {pt.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${pt.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(pt)
                    }}
                    className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none hover:text-destructive hover:border-destructive/40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {showNew ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex-1 min-w-[160px] space-y-1">
              <Label htmlFor="new-property-name">Name</Label>
              <Input
                id="new-property-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Projector, Wi-Fi, Parking..."
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="new-property-icon">Icon (optional)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      aria-label="Icon help"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    PascalCase lucide name (Mic, Monitor, Armchair, Wifi…).
                    Browse at{" "}
                    <a
                      href="https://lucide.dev/icons/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      lucide.dev/icons
                    </a>
                    .
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="new-property-icon"
                value={newIcon}
                onChange={(e) => setNewIcon(e.target.value)}
                placeholder="Mic"
              />
            </div>
            <div className="flex gap-2">
              <LoadingButton
                type="button"
                size="sm"
                loading={createMutation.isPending}
                disabled={!newName.trim()}
                onClick={() => createMutation.mutate()}
              >
                Create
              </LoadingButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
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
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowNew(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New property type
          </Button>
        )}
      </div>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete property type</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Remove "${pendingDelete.name}" from the tenant catalog? Any venue currently referencing it will lose this property. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="button"
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
    </InlineSection>
  )
}
