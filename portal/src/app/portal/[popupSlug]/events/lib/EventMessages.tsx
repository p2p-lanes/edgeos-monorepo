"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { type EventMessageCreate, EventMessagesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function EventMessages({
  eventId,
  occurrenceStart,
  canSend,
  timezone,
}: {
  eventId: string
  occurrenceStart?: string | null
  canSend: boolean
  timezone: string
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [body, setBody] = useState("")
  const [skip, setSkip] = useState(0)
  const attempt = useRef<EventMessageCreate | null>(null)
  const queryKey = ["portal-event-messages", eventId]
  const history = useQuery({
    queryKey: [...queryKey, skip],
    queryFn: () =>
      EventMessagesService.listEventMessages({ eventId, skip, limit: 20 }),
  })
  const send = useMutation({
    mutationFn: (requestBody: EventMessageCreate) =>
      EventMessagesService.sendEventMessage({ eventId, requestBody }),
    onSuccess: (result) => {
      if (result.completed_at) {
        setBody("")
        attempt.current = null
      }
      setSkip(0)
      queryClient.invalidateQueries({ queryKey })
      if (!result.completed_at) toast.info(t("events.messages.incomplete"))
      else if (result.failed_count)
        toast.warning(
          t("events.messages.result", {
            sent: result.sent_count,
            failed: result.failed_count,
          }),
        )
      else
        toast.success(t("events.messages.sent", { count: result.sent_count }))
    },
    onError: () => toast.error(t("events.messages.send_error")),
  })
  const submit = () => {
    const text = body.trim()
    if (!text) return
    if (
      !attempt.current ||
      attempt.current.body !== text ||
      attempt.current.occurrence_start !== occurrenceStart
    ) {
      attempt.current = {
        id: crypto.randomUUID(),
        body: text,
        occurrence_start: occurrenceStart,
      }
    }
    send.mutate(attempt.current)
  }
  const formatDate = (value: string, timeZone?: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value))

  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">{t("events.messages.heading")}</h3>
      {canSend && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t(
              occurrenceStart
                ? "events.messages.audience_occurrence"
                : "events.messages.audience_all",
            )}
          </p>
          <Label htmlFor={`host-message-${eventId}`}>
            {t("events.messages.message")}
          </Label>
          <Textarea
            id={`host-message-${eventId}`}
            value={body}
            maxLength={10000}
            rows={4}
            disabled={send.isPending}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" disabled={!body.trim() || send.isPending}>
            {t(
              send.isPending
                ? "events.messages.sending"
                : "events.messages.send",
            )}
          </Button>
        </form>
      )}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t("events.messages.history")}</h4>
        <Button
          variant="ghost"
          size="sm"
          disabled={history.isFetching}
          onClick={() => history.refetch()}
        >
          {t("events.messages.refresh")}
        </Button>
      </div>
      {history.isPending && (
        <p className="text-sm text-muted-foreground">
          {t("events.messages.loading")}
        </p>
      )}
      {history.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("events.messages.history_error")}
        </p>
      )}
      {history.data?.results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("events.messages.empty")}
        </p>
      )}
      {history.data?.results.map((message) => (
        <article key={message.id} className="border-t pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {message.author_name} · {formatDate(message.created_at)}
          </p>
          {message.occurrence_start && (
            <p className="text-xs text-muted-foreground">
              {t("events.messages.occurrence", {
                date: formatDate(message.occurrence_start, timezone),
              })}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.body}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("events.messages.result", {
              sent: message.sent_count,
              failed: message.failed_count,
            })}
          </p>
          {!message.completed_at && (
            <p className="text-xs text-muted-foreground">
              {t("events.messages.incomplete")}
            </p>
          )}
        </article>
      ))}
      {(skip > 0 || (history.data?.paging.total ?? 0) > 20) && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            disabled={skip === 0}
            onClick={() => setSkip(Math.max(0, skip - 20))}
          >
            {t("events.messages.previous")}
          </Button>
          <Button
            variant="outline"
            disabled={skip + 20 >= (history.data?.paging.total ?? 0)}
            onClick={() => setSkip(skip + 20)}
          >
            {t("events.messages.next")}
          </Button>
        </div>
      )}
    </section>
  )
}
