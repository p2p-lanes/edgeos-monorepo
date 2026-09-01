import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { AccommodationsService } from "@/client"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Date-range price overrides.
 *
 * There is no separate "weekend price" concept: a weekend, a high season and
 * a one-off promo are all the same thing: a range with a nightly price. The
 * highest `priority` covering a night wins, so a promo can be layered over a
 * season without renumbering anything.
 */

interface PriceRulesEditorProps {
  accommodationId: string | null
  currency?: string | null
}

export function PriceRulesEditor({
  accommodationId,
  currency,
}: PriceRulesEditorProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [label, setLabel] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [price, setPrice] = useState("")
  const [priority, setPriority] = useState("0")

  const { data: rules } = useQuery({
    queryKey: ["accommodations", "price-rules", accommodationId],
    queryFn: () =>
      AccommodationsService.listPriceRules({
        accommodationId: accommodationId as string,
      }),
    enabled: !!accommodationId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["accommodations", "price-rules", accommodationId],
    })

  const addRule = useMutation({
    mutationFn: () =>
      AccommodationsService.createPriceRule({
        accommodationId: accommodationId as string,
        requestBody: {
          label: label.trim() || null,
          start_date: startDate,
          end_date: endDate,
          nightly_price: price,
          priority: Number(priority) || 0,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Price rule added")
      setLabel("")
      setStartDate("")
      setEndDate("")
      setPrice("")
      setPriority("0")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const removeRule = useMutation({
    mutationFn: (ruleId: string) =>
      AccommodationsService.deletePriceRule({ ruleId }),
    onSuccess: () => {
      showSuccessToast("Price rule removed")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!accommodationId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the room first. Price rules attach to an existing room type.
      </p>
    )
  }

  const canAdd = Boolean(startDate && endDate && price.trim())

  return (
    <div className="flex flex-col gap-4">
      {(rules ?? []).length > 0 && (
        <div className="divide-y rounded-lg border">
          {(rules ?? []).map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-4 p-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {rule.label || "Date range"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {rule.start_date} → {rule.end_date}
                  {rule.priority ? ` · priority ${rule.priority}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums">
                  {rule.nightly_price} {currency ?? ""} / night
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove price rule"
                  disabled={removeRule.isPending}
                  onClick={() => removeRule.mutate(rule.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-label">Label</Label>
            <Input
              id="rule-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="High season"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-price">Nightly price</Label>
            <Input
              id="rule-price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="150.00"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To (inclusive)</Label>
            <DatePicker value={endDate} onChange={setEndDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-priority">Priority</Label>
            <Input
              id="rule-priority"
              type="number"
              step="1"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Higher wins when two ranges overlap.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!canAdd || addRule.isPending}
            onClick={() => addRule.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add rule
          </Button>
        </div>
      </div>
    </div>
  )
}
