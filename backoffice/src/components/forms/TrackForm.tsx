import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { type KeyboardEvent, useState } from "react"

import {
  type TrackCreate,
  type TrackPublic,
  TracksService,
  type TrackUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

interface TrackFormProps {
  defaultValues?: TrackPublic
  onSuccess: (track: TrackPublic) => void
}

interface TopicChipsInputProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

function TopicChipsInput({ value, onChange, disabled }: TopicChipsInputProps) {
  const [draft, setDraft] = useState("")

  const commit = () => {
    if (disabled) return
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
    if (disabled) return
    onChange(value.filter((t) => t !== topic))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit()
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
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
        disabled={disabled}
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
                disabled={disabled}
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20 disabled:opacity-50"
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const readOnly = !isAdmin
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: TrackCreate) =>
      TracksService.createTrack({ requestBody: data }),
    onSuccess: (track) => {
      showSuccessToast("Track created successfully")
      queryClient.invalidateQueries({ queryKey: ["tracks"] })
      form.reset()
      onSuccess(track)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: TrackUpdate) =>
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

  const deleteMutation = useMutation({
    mutationFn: () => TracksService.deleteTrack({ trackId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Track deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["tracks"] })
      navigate({ to: "/events/tracks" })
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
      if (readOnly) return
      if (isEdit) {
        const payload: TrackUpdate = {
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

      const payload: TrackCreate = {
        popup_id: selectedPopupId,
        name: value.name,
        description: value.description || undefined,
        topic: value.topic,
      }
      createMutation.mutate(payload)
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending
  const blocker = useUnsavedChanges(form)

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (readOnly) return
          form.handleSubmit().catch((err: unknown) => {
            showErrorToast(
              err instanceof Error ? err.message : "Error submitting form",
            )
          })
        }}
        className="mx-auto max-w-2xl space-y-8"
      >
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) =>
              !readOnly && !value.trim() ? "Name is required" : undefined,
          }}
        >
          {(field) => (
            <div>
              <HeroInput
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="Track Name"
                disabled={readOnly}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <div className="space-y-2">
              <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </p>
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={4}
                placeholder="Describe the track..."
                disabled={readOnly}
              />
            </div>
          )}
        </form.Field>

        <InlineSection title="Track Details">
          <InlineRow
            label="Topics"
            description="Press Enter or comma to add a topic"
          >
            <form.Field name="topic">
              {(field) => (
                <TopicChipsInput
                  value={field.state.value}
                  onChange={field.handleChange}
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>
        </InlineSection>

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/events/tracks" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Track"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && defaultValues && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this track, events referencing it will lose the track assignment. This action cannot be undone."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Track"
            resourceName={defaultValues.name}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
