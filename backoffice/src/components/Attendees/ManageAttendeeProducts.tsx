import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import {
  type ApiError,
  AttendeesService,
  type AttendeeWithOriginPublic,
  ProductsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Admin product management for a single attendee: change, remove, or add a
 * ticket directly, without going through the purchase flow.
 *
 * The ticket layer (attendee_products) is the source of truth here — grants and
 * refunds already decouple it from the original payment, so admins edit it
 * independently. Changing a ticket keeps its check-in code (the QR stays valid),
 * which is what week swaps and upgrades need. Removing a ticket frees its stock.
 */
export function ManageAttendeeProducts({
  attendee,
}: {
  attendee: AttendeeWithOriginPublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [addProductId, setAddProductId] = useState<string>("")

  const tickets = attendee.products ?? []

  const { data: productList, isLoading: productsLoading } = useQuery({
    queryKey: ["products", attendee.popup_id],
    queryFn: () =>
      ProductsService.listProducts({ popupId: attendee.popup_id, limit: 200 }),
  })
  const products = productList?.results ?? []

  const onMutationSuccess = (updated: AttendeeWithOriginPublic) => {
    queryClient.setQueryData(["attendees", attendee.id], updated)
    queryClient.invalidateQueries({ queryKey: ["attendees"] })
    queryClient.invalidateQueries({ queryKey: ["products", attendee.popup_id] })
  }

  const onMutationError = (err: ApiError) =>
    createErrorHandler(showErrorToast)(err)

  const swapMutation = useMutation({
    mutationFn: (vars: { ticketId: string; productId: string }) =>
      AttendeesService.swapAttendeeTicketProduct({
        attendeeId: attendee.id,
        ticketId: vars.ticketId,
        requestBody: { product_id: vars.productId },
      }),
    onSuccess: (updated) => {
      onMutationSuccess(updated)
      showSuccessToast("Ticket product updated")
    },
    onError: onMutationError,
  })

  const removeMutation = useMutation({
    mutationFn: (ticketId: string) =>
      AttendeesService.removeAttendeeTicket({
        attendeeId: attendee.id,
        ticketId,
      }),
    onSuccess: (updated) => {
      setConfirmRemoveId(null)
      onMutationSuccess(updated)
      showSuccessToast("Ticket removed")
    },
    onError: onMutationError,
  })

  const addMutation = useMutation({
    mutationFn: (productId: string) =>
      AttendeesService.addAttendeeTicket({
        attendeeId: attendee.id,
        requestBody: { product_id: productId },
      }),
    onSuccess: (updated) => {
      setAddProductId("")
      onMutationSuccess(updated)
      showSuccessToast("Ticket added")
    },
    onError: onMutationError,
  })

  const isBusy =
    swapMutation.isPending || removeMutation.isPending || addMutation.isPending

  if (productsLoading) {
    return (
      <InlineSection title="Tickets" className="px-6 py-4">
        <Skeleton className="h-10 w-full" />
      </InlineSection>
    )
  }

  return (
    <InlineSection title="Tickets" className="px-6 py-4">
      <div className="space-y-3">
        {tickets.length === 0 && (
          <p className="text-sm text-muted-foreground">No tickets yet.</p>
        )}

        {tickets.map((ticket) => (
          <div key={ticket.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={ticket.product_id}
                disabled={isBusy}
                onValueChange={(productId) => {
                  if (productId !== ticket.product_id) {
                    swapMutation.mutate({ ticketId: ticket.id, productId })
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={ticket.product_name ?? "Product"} />
                </SelectTrigger>
                <SelectContent>
                  {/* Keep the current product selectable even if it is no
                      longer in the active list (e.g. soft-deleted), so the
                      trigger never renders blank. */}
                  {!products.some((p) => p.id === ticket.product_id) && (
                    <SelectItem value={ticket.product_id}>
                      {ticket.product_name ?? "Current product"} (inactive)
                    </SelectItem>
                  )}
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                {ticket.check_in_code}
              </span>
            </div>

            {confirmRemoveId === ticket.id ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => removeMutation.mutate(ticket.id)}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => setConfirmRemoveId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove ticket"
                disabled={isBusy}
                onClick={() => setConfirmRemoveId(ticket.id)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        ))}

        {/* Add a ticket */}
        <div className="flex items-center gap-2 pt-1">
          <div className="min-w-0 flex-1">
            <Select
              value={addProductId}
              disabled={isBusy}
              onValueChange={setAddProductId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Add a ticket..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || !addProductId}
            onClick={() => addProductId && addMutation.mutate(addProductId)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
    </InlineSection>
  )
}
