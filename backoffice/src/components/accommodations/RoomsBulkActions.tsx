import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Eye, EyeOff, Percent, Tag } from "lucide-react"
import { useState } from "react"

import { type AccommodationPublic, AccommodationsService } from "@/client"
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
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Bulk edits over selected room types.
 *
 * A property with fifty rooms is the case this exists for: re-pricing them one
 * at a time is the difference between an operator using the tool and going
 * back to a spreadsheet. Percent moves the base price; "set" with no dates
 * replaces it. (A seasonal override is a date-range rule, edited per room.)
 */

interface RoomsBulkActionsProps {
  selected: AccommodationPublic[]
}

type PriceMode = "set" | "percent"

function PriceDialog({
  selected,
  mode,
  open,
  onOpenChange,
}: {
  selected: AccommodationPublic[]
  mode: PriceMode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [value, setValue] = useState("")

  const apply = useMutation({
    mutationFn: () =>
      AccommodationsService.bulkPriceAccommodations({
        requestBody: {
          ids: selected.map((room) => room.id),
          mode,
          value,
        },
      }),
    onSuccess: (result) => {
      showSuccessToast(
        `${result.updated} room${result.updated === 1 ? "" : "s"} re-priced`,
      )
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "set" ? "Set nightly price" : "Adjust nightly price"}
          </DialogTitle>
          <DialogDescription>
            Applies to {selected.length} selected room
            {selected.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-price-value">
            {mode === "set" ? "New nightly price" : "Change by (%)"}
          </Label>
          <Input
            id="bulk-price-value"
            type="number"
            step={mode === "set" ? "0.01" : "1"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={mode === "set" ? "120.00" : "10 or -10"}
          />
          <p className="text-xs text-muted-foreground">
            {mode === "set"
              ? "Replaces each room's base nightly price. Date-range rules are untouched."
              : "A negative value lowers the price. Rounded to cents per room."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={apply.isPending}
            disabled={!value.trim()}
            onClick={() => apply.mutate()}
          >
            Apply
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RoomsBulkActions({ selected }: RoomsBulkActionsProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [priceMode, setPriceMode] = useState<PriceMode | null>(null)

  const setVisibility = useMutation({
    mutationFn: (visible: boolean) =>
      AccommodationsService.bulkUpdateAccommodations({
        requestBody: {
          ids: selected.map((room) => room.id),
          patch: { visible_in_checkout: visible },
        },
      }),
    onSuccess: (result, visible) => {
      showSuccessToast(
        `${result.updated} room${result.updated === 1 ? "" : "s"} ${
          visible ? "shown in" : "hidden from"
        } the checkout`,
      )
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (selected.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPriceMode("set")}>
          <Tag className="mr-2 h-4 w-4" />
          Set price
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPriceMode("percent")}
        >
          <Percent className="mr-2 h-4 w-4" />
          Adjust %
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={setVisibility.isPending}
          onClick={() => setVisibility.mutate(true)}
        >
          <Eye className="mr-2 h-4 w-4" />
          Show
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={setVisibility.isPending}
          onClick={() => setVisibility.mutate(false)}
        >
          <EyeOff className="mr-2 h-4 w-4" />
          Hide
        </Button>
      </div>

      {priceMode && (
        <PriceDialog
          key={priceMode}
          selected={selected}
          mode={priceMode}
          open
          onOpenChange={(open) => !open && setPriceMode(null)}
        />
      )}
    </>
  )
}
