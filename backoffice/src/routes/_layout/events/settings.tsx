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

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
]

function gmtOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date())
    return parts.find((p) => p.type === "timeZoneName")?.value ?? ""
  } catch {
    return ""
  }
}

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
    humans_can_create_venues: false,
    venues_require_approval: true,
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="space-y-2">
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
        <p className="text-sm text-muted-foreground">
          When off, the events section is hidden in the portal for humans and no one can publish. Who can publish controls permission when on.
        </p>
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
            {TIMEZONES.map((tz) => {
              const offset = gmtOffset(tz)
              return (
                <SelectItem key={tz} value={tz}>
                  {offset ? `${tz} (${offset})` : tz}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Venue permissions</h2>
          <p className="text-sm text-muted-foreground">
            Control whether humans can create their own venues and whether those submissions need admin approval before use.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label className="text-base">Humans can create venues</Label>
            <p className="text-sm text-muted-foreground">
              Allow non-admin users to add new venues for this pop-up.
            </p>
          </div>
          <Switch
            checked={currentSettings.humans_can_create_venues ?? false}
            onCheckedChange={(checked) =>
              upsertMutation.mutate({
                ...currentSettings,
                popup_id: selectedPopupId!,
                humans_can_create_venues: checked,
              })
            }
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4 data-[disabled=true]:opacity-60" data-disabled={!currentSettings.humans_can_create_venues}>
          <div className="space-y-0.5">
            <Label className="text-base">Human-created venues require approval</Label>
            <p className="text-sm text-muted-foreground">
              When enabled, venues submitted by humans stay hidden until an admin approves them.
            </p>
          </div>
          <Switch
            checked={currentSettings.venues_require_approval ?? true}
            disabled={!currentSettings.humans_can_create_venues}
            onCheckedChange={(checked) =>
              upsertMutation.mutate({
                ...currentSettings,
                popup_id: selectedPopupId!,
                venues_require_approval: checked,
              })
            }
          />
        </div>
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
