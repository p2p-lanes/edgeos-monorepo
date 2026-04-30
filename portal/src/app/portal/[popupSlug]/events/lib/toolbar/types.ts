import type { TrackPublic } from "@/client"

export type EventsView = "list" | "calendar" | "day"

export interface EventsToolbarProps {
  view: EventsView
  onViewChange: (view: EventsView) => void
  search: string
  onSearchChange: (value: string) => void
  rsvpedOnly: boolean
  onRsvpedOnlyChange: (value: boolean) => void
  mineOnly: boolean
  onMineOnlyChange: (value: boolean) => void
  showHidden?: boolean
  onShowHiddenChange?: (value: boolean) => void
  hiddenCount?: number
  allowedTags?: string[]
  selectedTags?: string[]
  onSelectedTagsChange?: (tags: string[]) => void
  allowedTracks?: TrackPublic[]
  selectedTrackIds?: string[]
  onSelectedTrackIdsChange?: (ids: string[]) => void
}
