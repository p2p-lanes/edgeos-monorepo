import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { TicketTierGroupsService, type TierGroupPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface TierGroupPickerProps {
  popupId: string
  value: string | null
  onChange: (groupId: string | null) => void
  className?: string
}

export function TierGroupPicker({
  popupId,
  value,
  onChange,
  className,
}: TierGroupPickerProps) {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupCap, setNewGroupCap] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["tier-groups", popupId],
    queryFn: () => TicketTierGroupsService.listTierGroups({ popupId }),
    enabled: !!popupId,
  })

  const groups: TierGroupPublic[] = data?.results ?? []

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      TicketTierGroupsService.createTierGroup({
        requestBody: {
          name,
          shared_stock_cap: newGroupCap
            ? Number.parseInt(newGroupCap, 10)
            : null,
          popup_id: popupId,
        },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["tier-groups", popupId] })
      onChange(created.id)
      setShowCreateForm(false)
      setNewGroupName("")
      setNewGroupCap("")
    },
  })

  const handleGroupClick = (group: TierGroupPublic) => {
    if (value === group.id) {
      onChange(null)
    } else {
      onChange(group.id)
    }
  }

  const handleCreate = () => {
    const trimmed = newGroupName.trim()
    if (!trimmed) return
    createMutation.mutate(trimmed)
  }

  const isSoldOut = (group: TierGroupPublic) =>
    group.shared_stock_remaining !== null &&
    group.shared_stock_remaining !== undefined &&
    group.shared_stock_remaining === 0

  if (isLoading) {
    return (
      <div role="status" className="text-sm text-muted-foreground">
        Loading tier groups…
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-col gap-1.5">
        {groups.map((group) => {
          const selected = value === group.id
          const soldOut = isSoldOut(group)
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={selected}
              onClick={() => handleGroupClick(group)}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-sm text-left transition-colors hover:bg-accent",
                selected
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border",
              )}
            >
              <span>{group.name}</span>
              <div className="flex items-center gap-2">
                {soldOut && (
                  <Badge variant="secondary" className="text-xs">
                    Sold out
                  </Badge>
                )}
                {group.shared_stock_cap != null && (
                  <span className="text-xs text-muted-foreground">
                    {group.shared_stock_remaining ?? 0}/{group.shared_stock_cap}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {showCreateForm ? (
        <div className="rounded-md border border-dashed p-3 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            New Tier Group
          </p>
          <div className="space-y-2">
            <div>
              <Label htmlFor="tier-group-name" className="text-xs">
                Group Name
              </Label>
              <Input
                id="tier-group-name"
                placeholder="Group name (e.g. Early Bird)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleCreate()
                  }
                }}
                className="mt-1 text-sm"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="tier-group-cap" className="text-xs">
                Shared Stock Cap{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="tier-group-cap"
                type="number"
                min="1"
                placeholder="Unlimited"
                value={newGroupCap}
                onChange={(e) => setNewGroupCap(e.target.value)}
                className="mt-1 max-w-32 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!newGroupName.trim() || createMutation.isPending}
              onClick={handleCreate}
            >
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateForm(false)
                setNewGroupName("")
                setNewGroupCap("")
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
          onClick={() => setShowCreateForm(true)}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create new…
        </Button>
      )}
    </div>
  )
}
