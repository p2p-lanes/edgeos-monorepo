import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Ticket, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import {
  type ApiError,
  AttendeesService,
  type AttendeeWithOriginPublic,
  type ProductPublic,
  ProductsService,
  TicketingStepsService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import {
  computeTicketEligibility,
  isProductAssignable,
} from "@/lib/ticketEligibility"
import { createErrorHandler } from "@/utils"

/**
 * Admin product management for a single attendee: change a ticket's product,
 * remove a ticket, or add N products at once (bulk-grant style) with per-product
 * quantity and stock validation.
 *
 * The ticket layer (attendee_products) is the source of truth here — grants and
 * refunds already decouple it from the original payment, so admins edit it
 * independently. Changing a ticket keeps its check-in code (week swaps/upgrades);
 * removing one frees its stock. Only active products can be assigned (matching
 * what is sellable at checkout); the current product of an existing ticket stays
 * selectable even if it is no longer active.
 */
export function ManageAttendeeProducts({
  attendee,
}: {
  attendee: AttendeeWithOriginPublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})

  const tickets = attendee.products ?? []

  const productsKey = ["products", attendee.popup_id, { active: true }]
  const { data: productList, isLoading: productsLoading } = useQuery({
    queryKey: productsKey,
    queryFn: () =>
      ProductsService.listProducts({
        popupId: attendee.popup_id,
        isActive: true,
        limit: 200,
      }),
  })
  const allProducts = productList?.results ?? []

  // Ticketing-step segmentation: only show ticket products this attendee's
  // category may buy (mirrors the portal checkout). Products in non-segmented
  // categories (housing, merch, …) pass through unchanged.
  const { data: stepsList } = useQuery({
    queryKey: ["ticketing-steps", attendee.popup_id],
    queryFn: () =>
      TicketingStepsService.listTicketingSteps({
        popupId: attendee.popup_id,
        limit: 100,
      }),
  })
  const eligibility = useMemo(
    () =>
      computeTicketEligibility(
        stepsList?.results ?? [],
        attendee.category_id ?? null,
      ),
    [stepsList, attendee.category_id],
  )
  const products = useMemo(
    () => allProducts.filter((p) => isProductAssignable(p, eligibility)),
    [allProducts, eligibility],
  )

  const onMutationSuccess = (updated: AttendeeWithOriginPublic) => {
    queryClient.setQueryData(["attendees", attendee.id], updated)
    queryClient.invalidateQueries({ queryKey: ["attendees"] })
    queryClient.invalidateQueries({ queryKey: ["products", attendee.popup_id] })
    // Refresh the attendee's activity timeline so the new event shows up.
    queryClient.invalidateQueries({
      queryKey: ["audit-logs", { entityId: attendee.id }],
    })
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
    mutationFn: (items: { product_id: string; quantity: number }[]) =>
      AttendeesService.addAttendeeTicket({
        attendeeId: attendee.id,
        requestBody: { items },
      }),
    onSuccess: (updated) => {
      setQty({})
      onMutationSuccess(updated)
      showSuccessToast("Tickets added")
    },
    onError: onMutationError,
  })

  const isBusy =
    swapMutation.isPending || removeMutation.isPending || addMutation.isPending

  // ── Add-table selection helpers ──────────────────────────────────────────
  const toggle = (id: string, checked: boolean) =>
    setQty((prev) => {
      const next = { ...prev }
      if (checked) next[id] = prev[id] ?? 1
      else delete next[id]
      return next
    })
  const setQuantity = (id: string, value: number) =>
    setQty((prev) => ({ ...prev, [id]: value }))

  const isOverdrawn = (p: ProductPublic) =>
    p.id in qty &&
    p.total_stock_remaining != null &&
    qty[p.id] > p.total_stock_remaining

  const selectedItems = Object.entries(qty).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }))
  const anyOverdrawn = products.some(isOverdrawn)
  const canAdd = selectedItems.length > 0 && !anyOverdrawn && !isBusy

  if (productsLoading) {
    return (
      <InlineSection title="Tickets" className="px-6 py-4">
        <Skeleton className="h-10 w-full" />
      </InlineSection>
    )
  }

  return (
    <InlineSection title="Tickets" className="px-6 py-4">
      <div className="space-y-5">
        {/* Current tickets — what this attendee holds today */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Current tickets{tickets.length > 0 ? ` (${tickets.length})` : ""}
          </p>
          {tickets.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              This attendee has no tickets yet.
            </p>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <Select
                        value={ticket.product_id}
                        disabled={isBusy}
                        onValueChange={(productId) => {
                          if (productId !== ticket.product_id) {
                            swapMutation.mutate({
                              ticketId: ticket.id,
                              productId,
                            })
                          }
                        }}
                      >
                        <SelectTrigger className="w-full border-0 px-0 font-medium shadow-none focus:ring-0">
                          <SelectValue
                            placeholder={ticket.product_name ?? "Product"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Keep the current product selectable even if it is
                              no longer active, so it never renders blank. */}
                          {!products.some(
                            (p) => p.id === ticket.product_id,
                          ) && (
                            <SelectItem value={ticket.product_id}>
                              {ticket.product_name ?? "Current product"}{" "}
                              (inactive)
                            </SelectItem>
                          )}
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {confirmRemoveId === ticket.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => removeMutation.mutate(ticket.id)}
                        >
                          Remove
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
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">
                    Code:{" "}
                    <span className="font-mono">{ticket.check_in_code}</span>
                    <span className="ml-2 italic">
                      · tap the name to change
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add tickets — pick N active products with quantities (stock-validated) */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Add tickets</p>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products available for this attendee's category.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Selected</span>
                    </TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-20 text-right">Stock</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const selected = p.id in qty
                    const over = isOverdrawn(p)
                    return (
                      <TableRow
                        key={p.id}
                        className={over ? "bg-destructive/10" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            disabled={isBusy}
                            onCheckedChange={(c) => toggle(p.id, !!c)}
                            aria-label={`Select ${p.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{p.name}</span>
                            {over && p.total_stock_remaining != null && (
                              <span className="mt-0.5 text-xs font-medium text-destructive">
                                Only {p.total_stock_remaining} in stock.
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {p.total_stock_remaining == null ? (
                            <Badge variant="outline">∞</Badge>
                          ) : (
                            p.total_stock_remaining
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            disabled={!selected || isBusy}
                            value={selected ? (qty[p.id] ?? 1) : ""}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              setQuantity(
                                p.id,
                                Number.isFinite(v) && v > 0 ? Math.floor(v) : 1,
                              )
                            }}
                            className={
                              over ? "border-destructive text-destructive" : ""
                            }
                            aria-invalid={over}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!canAdd}
                  onClick={() => addMutation.mutate(selectedItems)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add{" "}
                  {selectedItems.length > 0
                    ? `${selectedItems.reduce((n, i) => n + i.quantity, 0)} `
                    : ""}
                  ticket
                  {selectedItems.reduce((n, i) => n + i.quantity, 0) === 1
                    ? ""
                    : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </InlineSection>
  )
}
