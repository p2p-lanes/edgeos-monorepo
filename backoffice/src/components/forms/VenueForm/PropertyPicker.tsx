import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import {
  type VenuePropertyTypePublic,
  VenuePropertyTypesService,
} from "@/client"
import { LucideIconPicker } from "@/components/LucideIconPicker"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { LucideIcon } from "@/lib/lucide-icon"
import { createErrorHandler } from "@/utils"

interface PropertyPickerProps {
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

export function PropertyPicker({
  value,
  onChange,
  disabled,
}: PropertyPickerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { selectedTenantId } = useWorkspace()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("")

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

  const toggle = (id: string) => {
    if (disabled) return
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <InlineSection title="Properties">
      <p className="px-1 pt-2 text-xs text-muted-foreground">
        Select which properties this venue has. Manage the catalog in Venue
        Properties.
      </p>
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
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => toggle(pt.id)}
                  aria-pressed={selected}
                  disabled={disabled}
                  className={`flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                      : "bg-card text-foreground hover:bg-muted/50"
                  }`}
                >
                  <LucideIcon name={pt.icon} className="h-6 w-6 shrink-0" />
                  <span className="line-clamp-2 break-all text-center">
                    {pt.name}
                  </span>
                </button>
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
          !disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowNew(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              New property type
            </Button>
          )
        )}
      </div>
    </InlineSection>
  )
}
