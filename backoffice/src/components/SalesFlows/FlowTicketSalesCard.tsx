import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { useId, useState } from "react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

// Mirrors the backend ceilings on the two texts.
export const COMING_SOON_TITLE_MAX_LENGTH = 200
export const COMING_SOON_MESSAGE_MAX_LENGTH = 2000

type TicketSalesStatus = NonNullable<SalesFlowPublic["ticket_sales_status"]>

/**
 * Whether this sales flow sells yet.
 *
 * Holding sales as "coming soon" is not closing the flow: it keeps taking
 * applications and accepting people, who see the message below instead of a
 * checkout until sales open. The server refuses every purchase meanwhile, so
 * this is the switch, not just a screen.
 *
 * The status and both texts are saved together, on purpose: flipping a
 * buyer-facing switch should be a deliberate save, not a stray click.
 */
export function FlowTicketSalesCard({ flow }: { flow: SalesFlowPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const switchId = useId()
  const titleId = useId()
  const messageId = useId()

  const savedStatus: TicketSalesStatus = flow.ticket_sales_status ?? "open"
  const savedTitle = flow.coming_soon_title ?? ""
  const savedMessage = flow.coming_soon_message ?? ""
  const [status, setStatus] = useState<TicketSalesStatus>(savedStatus)
  const [title, setTitle] = useState(savedTitle)
  const [message, setMessage] = useState(savedMessage)

  const isDirty =
    status !== savedStatus ||
    title.trim() !== savedTitle ||
    message.trim() !== savedMessage
  const salesOpen = status === "open"

  const mutation = useMutation({
    mutationFn: () =>
      SalesFlowsService.updateSalesFlow({
        flowId: flow.id,
        requestBody: {
          ticket_sales_status: status,
          coming_soon_title: title.trim() || null,
          coming_soon_message: message.trim() || null,
        },
      }),
    onSuccess: (updated) => {
      setTitle(updated.coming_soon_title ?? "")
      setMessage(updated.coming_soon_message ?? "")
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      showSuccessToast(
        updated.ticket_sales_status === "coming_soon"
          ? "Ticket sales are now coming soon"
          : "Ticket sales saved",
      )
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <section
      aria-labelledby={`${switchId}-heading`}
      className={`space-y-4 rounded-xl border px-4 py-3 ${
        salesOpen ? "" : "border-warning/40 bg-warning-soft"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {!salesOpen && (
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        )}
        <div className="min-w-0 flex-1">
          <p id={`${switchId}-heading`} className="text-sm font-semibold">
            {salesOpen ? "Ticket sales are open" : "Ticket sales coming soon"}
          </p>
          <p className="text-sm text-muted-foreground">
            {salesOpen
              ? "Accepted people can buy through this flow."
              : "Applications keep coming in, but nobody can buy yet. Accepted people see the message below instead of the checkout."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={switchId} className="text-sm">
            Sales open
          </Label>
          <Switch
            id={switchId}
            checked={salesOpen}
            onCheckedChange={(checked) =>
              setStatus(checked ? "open" : "coming_soon")
            }
          />
        </div>
      </div>

      {!salesOpen && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={titleId}>Coming soon title</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={COMING_SOON_TITLE_MAX_LENGTH}
              placeholder="Tickets coming soon"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={messageId}>Coming soon message</Label>
            <Textarea
              id={messageId}
              value={message}
              rows={3}
              maxLength={COMING_SOON_MESSAGE_MAX_LENGTH}
              placeholder="Ticket sales for this event haven't opened yet. Please check back soon."
              onChange={(event) => setMessage(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave either empty to show the default text, translated into the
              buyer's language.
            </p>
          </div>
        </div>
      )}

      {isDirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => {
              setStatus(savedStatus)
              setTitle(savedTitle)
              setMessage(savedMessage)
            }}
          >
            Discard
          </Button>
          <Button
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save ticket sales
          </Button>
        </div>
      )}
    </section>
  )
}
