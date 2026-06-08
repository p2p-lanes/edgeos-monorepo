import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpDown, GripVertical, MapPin } from "lucide-react"
import { useEffect, useState } from "react"

import {
  type ApiError,
  type EventVenuePublic,
  EventVenuesService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

interface OrderVenuesDialogProps {
  popupId: string
}

function SortableVenueItem({
  venue,
  rank,
}: {
  venue: EventVenuePublic
  rank: number
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: venue.id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-md border bg-card px-3 py-2.5",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
        aria-label={`Drag to reorder ${venue.title || "venue"}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums text-muted-foreground">
        {rank}
      </span>
      <span className="truncate font-medium">
        {venue.title || "Untitled venue"}
      </span>
    </li>
  )
}

/**
 * "Order venues" button + modal. Opens a focused drag-and-drop ranking of all
 * venues in the selected pop-up. Saving persists the new `display_order`, which
 * the venue lists and calendar day views consume in API order.
 */
export function OrderVenuesDialog({ popupId }: OrderVenuesDialogProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<EventVenuePublic[]>([])
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data, isLoading } = useQuery({
    queryKey: ["event-venues", "order", { popupId }],
    queryFn: () =>
      EventVenuesService.listVenues({ popupId, skip: 0, limit: 500 }),
    enabled: open && !!popupId,
  })

  // Reset the working order to the server order whenever the dialog opens
  // or fresh data arrives.
  useEffect(() => {
    if (data?.results) setItems(data.results)
  }, [data])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const reorderMutation = useMutation({
    mutationFn: (venueIds: string[]) =>
      EventVenuesService.reorderVenues({
        requestBody: { popup_id: popupId, venue_ids: venueIds },
      }),
    onSuccess: () => {
      showSuccessToast("Venue order saved")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast) as (err: ApiError) => void,
  })

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setItems((prev) => {
      const oldIdx = prev.findIndex((v) => v.id === e.active.id)
      const newIdx = prev.findIndex((v) => v.id === e.over!.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowUpDown className="mr-2 h-4 w-4" />
          Order Venues
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Order venues</DialogTitle>
          <DialogDescription>
            Drag to set the order venues appear in lists and calendar day views.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <MapPin className="h-6 w-6 text-muted-foreground/40" />
              No venues to order yet.
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((v) => v.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1.5">
                  {items.map((venue, idx) => (
                    <SortableVenueItem
                      key={venue.id}
                      venue={venue}
                      rank={idx + 1}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={reorderMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => reorderMutation.mutate(items.map((v) => v.id))}
            disabled={reorderMutation.isPending || items.length === 0}
          >
            {reorderMutation.isPending ? "Saving..." : "Save order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
