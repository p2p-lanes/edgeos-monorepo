import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Calendar, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { EventVenuesService, type VenueExceptionPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InlineSection } from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface ExceptionsEditorProps {
  venueId: string
}

interface ExceptionDialogState {
  open: boolean
  editing: VenueExceptionPublic | null
  start_datetime: string
  end_datetime: string
  reason: string
  is_closed: boolean
}

const EMPTY_EXCEPTION: ExceptionDialogState = {
  open: false,
  editing: null,
  start_datetime: "",
  end_datetime: "",
  reason: "",
  is_closed: true,
}

function toLocalDateTimeString(iso: string | null | undefined): string {
  if (!iso) return ""
  // Accept both ISO with Z/offset and local naive — return YYYY-MM-DDTHH:mm
  // Treat as local display value for the DateTimePicker.
  return iso.slice(0, 16)
}

export function ExceptionsEditor({ venueId }: ExceptionsEditorProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [state, setState] = useState<ExceptionDialogState>(EMPTY_EXCEPTION)

  const { data: exceptions = [] } = useQuery({
    queryKey: ["event-venues", venueId, "exceptions"],
    queryFn: () => EventVenuesService.listExceptions({ venueId }),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["event-venues", venueId, "exceptions"],
    })

  const createMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.createException({
        venueId,
        requestBody: {
          start_datetime: new Date(state.start_datetime).toISOString(),
          end_datetime: new Date(state.end_datetime).toISOString(),
          reason: state.reason || null,
          is_closed: state.is_closed,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Exception added")
      invalidate()
      setState(EMPTY_EXCEPTION)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.updateException({
        venueId,
        exceptionId: state.editing!.id,
        requestBody: {
          start_datetime: new Date(state.start_datetime).toISOString(),
          end_datetime: new Date(state.end_datetime).toISOString(),
          reason: state.reason || null,
          is_closed: state.is_closed,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Exception updated")
      invalidate()
      setState(EMPTY_EXCEPTION)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (exceptionId: string) =>
      EventVenuesService.deleteException({ venueId, exceptionId }),
    onSuccess: () => {
      showSuccessToast("Exception removed")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const openAdd = () =>
    setState({
      open: true,
      editing: null,
      start_datetime: "",
      end_datetime: "",
      reason: "",
      is_closed: true,
    })

  const openEdit = (exc: VenueExceptionPublic) =>
    setState({
      open: true,
      editing: exc,
      start_datetime: toLocalDateTimeString(exc.start_datetime),
      end_datetime: toLocalDateTimeString(exc.end_datetime),
      reason: exc.reason ?? "",
      is_closed: exc.is_closed,
    })

  const save = () => {
    if (!state.start_datetime || !state.end_datetime) {
      showErrorToast("Start and end datetimes are required")
      return
    }
    if (state.editing) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending

  const formatRange = (exc: VenueExceptionPublic) => {
    const s = new Date(exc.start_datetime)
    const e = new Date(exc.end_datetime)
    return `${s.toLocaleString()} → ${e.toLocaleString()}`
  }

  return (
    <InlineSection title="Exceptions">
      <div className="space-y-2 py-3">
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exceptions. Add one to override weekly hours on specific dates.
          </p>
        ) : (
          <ul className="space-y-2">
            {exceptions.map((exc) => (
              <li
                key={exc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      {formatRange(exc)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={exc.is_closed ? "destructive" : "secondary"}>
                        {exc.is_closed ? "Closed" : "Open"}
                      </Badge>
                      {exc.reason && <span>{exc.reason}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Edit exception"
                    onClick={() => openEdit(exc)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete exception"
                    onClick={() => deleteMutation.mutate(exc.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add exception
          </Button>
        </div>
      </div>

      <Dialog
        open={state.open}
        onOpenChange={(open) =>
          setState((prev) => ({ ...prev, open: open ? prev.open : false }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {state.editing ? "Edit exception" : "New exception"}
            </DialogTitle>
            <DialogDescription>
              Overrides weekly hours on a specific date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <DateTimePicker
                value={state.start_datetime}
                onChange={(v) =>
                  setState((prev) => ({ ...prev, start_datetime: v }))
                }
                placeholder="Select start date"
              />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <DateTimePicker
                value={state.end_datetime}
                onChange={(v) =>
                  setState((prev) => ({ ...prev, end_datetime: v }))
                }
                placeholder="Select end date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exception-reason">Reason</Label>
              <Textarea
                id="exception-reason"
                value={state.reason}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, reason: e.target.value }))
                }
                rows={2}
                placeholder="Holiday, maintenance, special event..."
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="exception-closed">Closed</Label>
              <Switch
                id="exception-closed"
                checked={state.is_closed}
                onCheckedChange={(checked) =>
                  setState((prev) => ({ ...prev, is_closed: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setState(EMPTY_EXCEPTION)}
            >
              Cancel
            </Button>
            <LoadingButton type="button" loading={saving} onClick={save}>
              {state.editing ? "Save" : "Create"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InlineSection>
  )
}
