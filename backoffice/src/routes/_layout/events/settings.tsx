import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventSettingsService, type EventSettingsCreate } from "@/client"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/events/settings")({
  component: EventSettingsPage,
  head: () => ({
    meta: [{ title: "Event Settings - EdgeOS" }],
  }),
})

function EventSettingsForm() {
  const { selectedPopupId } = useWorkspace()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: settings, isLoading } = useQuery({
    queryKey: ["event-settings", selectedPopupId],
    queryFn: async () => {
      try {
        return await EventSettingsService.getEventSettings({ popupId: selectedPopupId! })
      } catch {
        return null
      }
    },
    enabled: !!selectedPopupId,
    retry: false,
  })

  const upsertMutation = useMutation({
    mutationFn: (data: EventSettingsCreate) =>
      EventSettingsService.upsertEventSettings({
        popupId: selectedPopupId!,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Event settings saved")
      queryClient.invalidateQueries({ queryKey: ["event-settings"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const currentSettings = settings ?? {
    popup_id: selectedPopupId!,
    can_publish_event: "everyone" as const,
    event_enabled: true,
    timezone: "UTC",
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label className="text-base">Events Enabled</Label>
          <p className="text-sm text-muted-foreground">
            Allow event creation for this pop-up
          </p>
        </div>
        <Switch
          checked={currentSettings.event_enabled}
          onCheckedChange={(checked) =>
            upsertMutation.mutate({
              ...currentSettings,
              popup_id: selectedPopupId!,
              event_enabled: checked,
            })
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Who Can Publish Events</Label>
        <Select
          value={currentSettings.can_publish_event}
          onValueChange={(value) =>
            upsertMutation.mutate({
              ...currentSettings,
              popup_id: selectedPopupId!,
              can_publish_event: value as "everyone" | "admin_only",
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="everyone">Everyone</SelectItem>
            <SelectItem value="admin_only">Admins Only</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Controls who can publish events. Drafts can always be created by anyone.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Default Timezone</Label>
        <Select
          value={currentSettings.timezone}
          onValueChange={(value) =>
            upsertMutation.mutate({
              ...currentSettings,
              popup_id: selectedPopupId!,
              timezone: value,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="UTC">UTC</SelectItem>
            <SelectItem value="America/New_York">America/New_York</SelectItem>
            <SelectItem value="America/Chicago">America/Chicago</SelectItem>
            <SelectItem value="America/Denver">America/Denver</SelectItem>
            <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
            <SelectItem value="America/Argentina/Buenos_Aires">America/Argentina/Buenos_Aires</SelectItem>
            <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
            <SelectItem value="Europe/London">Europe/London</SelectItem>
            <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
            <SelectItem value="Europe/Berlin">Europe/Berlin</SelectItem>
            <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
            <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
            <SelectItem value="Asia/Singapore">Asia/Singapore</SelectItem>
            <SelectItem value="Australia/Sydney">Australia/Sydney</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function EventSettingsPage() {
  const { selectedPopupId } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Settings</h1>
        <p className="text-muted-foreground">
          Configure event creation and publishing rules for this pop-up
        </p>
      </div>
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EventSettingsForm />
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <p className="text-muted-foreground">Select a pop-up from the sidebar to configure event settings.</p>
      )}
    </div>
  )
}
