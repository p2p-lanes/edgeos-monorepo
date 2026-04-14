import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { type KeyboardEvent, useState } from "react"

import {
  type TrackCreate,
  type TrackPublic,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface TrackFormProps {
  defaultValues?: TrackPublic
  onSuccess: (track: TrackPublic) => void
}

interface TopicChipsInputProps {
  value: string[]
  onChange: (next: string[]) => void
}

function TopicChipsInput({ value, onChange }: TopicChipsInputProps) {
  const [draft, setDraft] = useState("")

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (value.includes(trimmed)) {
      setDraft("")
      return
    }
    onChange([...value, trimmed])
    setDraft("")
  }

  const remove = (topic: string) => {
    onChange(value.filter((t) => t !== topic))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit()
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      // Remove last chip on backspace when input is empty
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder="Type a topic and press Enter"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((topic) => (
            <Badge key={topic} variant="secondary" className="gap-1 pr-1">
              <span>{topic}</span>
              <button
                type="button"
                aria-label={`Remove ${topic}`}
                onClick={() => remove(topic)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function TrackForm({ defaultValues, onSuccess }: TrackFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      TracksService.createTrack({ requestBody: data as TrackCreate }),
    onSuccess: (track) => {
      showSuccessToast("Track created successfully")
      queryClient.invalidateQueries({ queryKey: ["tracks"] })
      form.reset()
      onSuccess(track)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      TracksService.updateTrack({
        trackId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: (track) => {
      showSuccessToast("Track updated successfully")
      queryClient.invalidateQueries({ queryKey: ["tracks"] })
      onSuccess(track)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      topic: defaultValues?.topic ?? ([] as string[]),
    },
    onSubmit: ({ value }) => {
      if (!value.name.trim()) {
        showErrorToast("Name is required")
        return
      }

      if (isEdit) {
        const payload: Record<string, unknown> = {
          name: value.name,
          description: value.description || null,
          topic: value.topic,
        }
        updateMutation.mutate(payload)
        return
      }

      if (!selectedPopupId) {
        showErrorToast("Select a pop-up first")
        return
      }

      const payload: Record<string, unknown> = {
        popup_id: selectedPopupId,
        name: value.name,
        description: value.description || null,
        topic: value.topic,
      }
      createMutation.mutate(payload)
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
      <form.Field name="name">
        {(field) => (
          <HeroInput
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="Track Name"
          />
        )}
      </form.Field>

      <InlineSection title="Track Details">
        <InlineRow label="Description" description="What this track is about">
          <form.Field name="description">
            {(field) => (
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={4}
                placeholder="Describe the track..."
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow
          label="Topics"
          description="Press Enter or comma to add a topic"
        >
          <form.Field name="topic">
            {(field) => (
              <TopicChipsInput
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <div className="flex justify-end gap-3">
        <LoadingButton type="submit" loading={isPending}>
          {isEdit ? "Save Changes" : "Create Track"}
        </LoadingButton>
      </div>
    </form>
  )
}
