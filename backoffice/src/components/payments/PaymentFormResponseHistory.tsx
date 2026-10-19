import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { PaymentsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function answer(value: unknown): string {
  if (value == null || value === "") return "Not answered"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value))
    return value.length ? value.map(answer).join(", ") : "Not answered"
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

export function PaymentFormResponseHistory({
  paymentId,
}: {
  paymentId: string
}) {
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ["payment-form-response-history", paymentId],
    queryFn: () => PaymentsService.getPaymentFormResponses({ paymentId }),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Response history
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Response history</DialogTitle>
        </DialogHeader>
        {query.isLoading ? (
          <p>Loading history…</p>
        ) : query.isError ? (
          <p role="alert">Could not load response history.</p>
        ) : !query.data?.history.length ? (
          <p className="text-sm text-muted-foreground">
            No answers have been edited.
          </p>
        ) : (
          <ul className="space-y-4">
            {query.data.history.map((change) => (
              <li
                key={`${change.version}-${change.field_id}`}
                className="rounded-lg border p-3 text-sm"
              >
                <p className="font-medium">{change.field_label}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {answer(change.old_value)} → {answer(change.new_value)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(change.changed_at).toLocaleString()} · Version{" "}
                  {change.version}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Buyer: {change.changed_by_human_id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
