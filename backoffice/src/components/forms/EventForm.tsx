import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  type EventCreate,
  type EventPublic,
  EventsService,
  EventVenuesService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import { Input } from "@/components/ui/input"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface EventFormProps {
  defaultValues?: EventPublic
  onSuccess: () => void
}

const EVENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
] as const

export function EventForm({ defaultValues, onSuccess }: EventFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const isEdit = !!defaultValues

  const { data: venues } = useQuery({
    queryKey: ["event-venues", selectedPopupId],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId: selectedPopupId!,
        limit: 200,
      }),
    enabled: !!selectedPopupId,
  })

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventsService.createEvent({ requestBody: data as EventCreate }),
    onSuccess: () => {
      showSuccessToast("Event created successfully")
      queryClient.invalidateQueries({ queryKey: ["events"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventsService.updateEvent({
        eventId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Event updated successfully")
      queryClient.invalidateQueries({ queryKey: ["events"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const formatForInput = (dt: string | null | undefined) => {
    if (!dt) return ""
    return dt.slice(0, 16)
  }

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      content: defaultValues?.content ?? "",
      kind: defaultValues?.kind ?? "",
      start_time: formatForInput(defaultValues?.start_time),
      end_time: formatForInput(defaultValues?.end_time),
      timezone: defaultValues?.timezone ?? "UTC",
      location: defaultValues?.location ?? "",
      cover_url: defaultValues?.cover_url ?? "",
      meeting_url: defaultValues?.meeting_url ?? "",
      max_participant: defaultValues?.max_participant?.toString() ?? "",
      venue_id: defaultValues?.venue_id ?? "",
      require_approval: defaultValues?.require_approval ?? false,
      status: defaultValues?.status ?? "draft",
      tags_input: (defaultValues?.tags ?? []).join(", "),
    },
    onSubmit: ({ value }) => {
      if (!value.title.trim()) {
        showErrorToast("Title is required")
        return
      }
      if (!value.start_time || !value.end_time) {
        showErrorToast("Start and end times are required")
        return
      }
      if (!selectedPopupId) {
        showErrorToast("Select a pop-up first")
        return
      }

      const tags = value.tags_input
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)

      const payload: Record<string, unknown> = {
        popup_id: selectedPopupId,
        title: value.title,
        content: value.content || null,
        kind: value.kind || null,
        start_time: new Date(value.start_time).toISOString(),
        end_time: new Date(value.end_time).toISOString(),
        timezone: value.timezone,
        location: value.location || null,
        cover_url: value.cover_url || null,
        meeting_url: value.meeting_url || null,
        max_participant: value.max_participant
          ? parseInt(value.max_participant)
          : null,
        venue_id: value.venue_id || null,
        require_approval: value.require_approval,
        status: value.status,
        tags,
      }

      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate(payload)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit().catch((err: unknown) => {
          showErrorToast(err instanceof Error ? err.message : "Error submitting form")
        })
      }}
      className="max-w-2xl space-y-8"
    >
      <form.Field name="title">
        {(field) => (
          <HeroInput
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="Event Title"
          />
        )}
      </form.Field>

      <InlineSection title="Event Details">
        <InlineRow label="Type" description="Category of the event">
          <form.Field name="kind">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="workshop, social, talk, panel..."
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Start" description="When the event begins">
          <form.Field name="start_time">
            {(field) => (
              <DateTimePicker
                value={field.state.value}
                onChange={field.handleChange}
                placeholder="Select start date"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="End" description="When the event ends">
          <form.Field name="end_time">
            {(field) => (
              <DateTimePicker
                value={field.state.value}
                onChange={field.handleChange}
                placeholder="Select end date"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Location" description="Where the event takes place">
          <form.Field name="location">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Address or place name"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Venue" description="Select a pre-configured venue">
          <form.Field name="venue_id">
            {(field) => (
              <Select
                value={field.state.value || undefined}
                onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No venue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No venue</SelectItem>
                  {venues?.results.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                      {v.capacity ? ` (cap. ${v.capacity})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Description" description="Details about the event">
          <form.Field name="content">
            {(field) => (
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={4}
                placeholder="Describe the event..."
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <InlineSection title="Media & Links">
        <InlineRow label="Cover Image URL">
          <form.Field name="cover_url">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://..."
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Meeting Link" description="Virtual meeting URL">
          <form.Field name="meeting_url">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://meet.google.com/..."
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <InlineSection title="Options">
        <InlineRow label="Tags" description="Comma-separated tags">
          <form.Field name="tags_input">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="social, workshop, networking"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Max Participants" description="Leave empty for unlimited">
          <form.Field name="max_participant">
            {(field) => (
              <Input
                type="number"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Unlimited"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Require Approval" description="Participants need admin approval">
          <form.Field name="require_approval">
            {(field) => (
              <Switch
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Status">
          <form.Field name="status">
            {(field) => (
              <div className="flex gap-2">
                {EVENT_STATUSES.map((s) => (
                  <Badge
                    key={s.value}
                    variant={field.state.value === s.value ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => field.handleChange(s.value)}
                  >
                    {s.label}
                  </Badge>
                ))}
              </div>
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <div className="flex justify-end gap-3">
        <LoadingButton type="submit" loading={isPending}>
          {isEdit ? "Save Changes" : "Create Event"}
        </LoadingButton>
      </div>
    </form>
  )
}
