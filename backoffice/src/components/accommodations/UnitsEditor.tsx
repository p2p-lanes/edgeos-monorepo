import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { AccommodationsService, type AccommodationUnitPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * The physical rooms behind a room type.
 *
 * A booking occupies a unit, never a type, which is why availability is a
 * count of free units rather than a stock number. Deactivating a unit takes
 * it out of new assignments while leaving its existing stays on the calendar;
 * deleting one is refused by the API while a guest is (or will be) in it.
 */

interface UnitsEditorProps {
  accommodationId: string | null
  units: AccommodationUnitPublic[]
}

export function UnitsEditor({ accommodationId, units }: UnitsEditorProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [prefix, setPrefix] = useState("Room ")
  const [count, setCount] = useState("1")

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["accommodations"] })

  const addUnits = useMutation({
    mutationFn: () =>
      AccommodationsService.bulkCreateUnits({
        accommodationId: accommodationId as string,
        requestBody: { prefix, count: Number(count) || 1 },
      }),
    onSuccess: (created) => {
      showSuccessToast(
        created.length === 0
          ? "Those labels already exist"
          : `${created.length} unit${created.length === 1 ? "" : "s"} added`,
      )
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const toggleUnit = useMutation({
    mutationFn: ({ unitId, isActive }: { unitId: string; isActive: boolean }) =>
      AccommodationsService.updateUnit({
        unitId,
        requestBody: { is_active: isActive },
      }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })

  const removeUnit = useMutation({
    mutationFn: (unitId: string) =>
      AccommodationsService.deleteUnit({ unitId }),
    onSuccess: () => {
      showSuccessToast("Unit removed")
      invalidate()
    },
    // A unit with active bookings comes back as a 409 telling the operator to
    // deactivate it instead; the server's message is the useful one.
    onError: createErrorHandler(showErrorToast),
  })

  if (!accommodationId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the room first. Units attach to an existing room type.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {units.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {units.map((unit) => (
            <div
              key={unit.id}
              className="flex items-center justify-between gap-4 p-3"
            >
              <span className="text-sm font-medium">{unit.label}</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {unit.is_active ? "Active" : "Inactive"}
                  </span>
                  <Switch
                    checked={unit.is_active}
                    aria-label={`${unit.label} active`}
                    onCheckedChange={(isActive) =>
                      toggleUnit.mutate({ unitId: unit.id, isActive })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${unit.label}`}
                  disabled={removeUnit.isPending}
                  onClick={() => removeUnit.mutate(unit.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No units yet. Without one this room type can never be booked: the
          checkout has nothing to assign.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unit-prefix">Label prefix</Label>
          <Input
            id="unit-prefix"
            className="w-40"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="Room "
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unit-count">How many</Label>
          <Input
            id="unit-count"
            className="w-24"
            type="number"
            min="1"
            max="500"
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={addUnits.isPending}
          onClick={() => addUnits.mutate()}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add units
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Creates "{prefix}1" … "{prefix}
          {Number(count) || 1}". Labels that already exist are skipped, so
          running this again only adds what is missing.
        </p>
      </div>
    </div>
  )
}
