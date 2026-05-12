export type EventsView = "list" | "calendar" | "day"

export interface EventsToolbarProps {
  view: EventsView
  onViewChange: (view: EventsView) => void
  search: string
  onSearchChange: (value: string) => void
  /**
   * "My RSVPs" toggle. Omit ``onRsvpedOnlyChange`` to hide the toggle
   * (used by the public calendar, which has no logged-in human).
   */
  rsvpedOnly?: boolean
  onRsvpedOnlyChange?: (value: boolean) => void
  /**
   * "My events" toggle. Omit ``onMineOnlyChange`` to hide it.
   */
  mineOnly?: boolean
  onMineOnlyChange?: (value: boolean) => void
  showHidden?: boolean
  onShowHiddenChange?: (value: boolean) => void
  hiddenCount?: number
  allowedTags?: string[]
  selectedTags?: string[]
  onSelectedTagsChange?: (tags: string[]) => void
  allowedTracks?: { id: string; name: string }[]
  selectedTrackIds?: string[]
  onSelectedTrackIdsChange?: (ids: string[]) => void
}
