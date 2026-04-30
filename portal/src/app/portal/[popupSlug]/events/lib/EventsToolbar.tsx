"use client"

import {
  HiddenToggle,
  MineToggle,
  RsvpedToggle,
} from "./toolbar/parts/FilterToggleButtons"
import { SearchField } from "./toolbar/parts/SearchField"
import { TagsPopover } from "./toolbar/parts/TagsPopover"
import { TracksPopover } from "./toolbar/parts/TracksPopover"
import { ViewSwitcher } from "./toolbar/parts/ViewSwitcher"
import type { EventsToolbarProps } from "./toolbar/types"

export type { EventsToolbarProps, EventsView } from "./toolbar/types"

/**
 * Two-row toolbar: search and view switcher are anchored to the top row;
 * filter triggers live in their own row below so they can wrap freely
 * without ever pushing the view switcher to a new line.
 */
export function EventsToolbar(props: EventsToolbarProps) {
  const {
    view,
    onViewChange,
    search,
    onSearchChange,
    rsvpedOnly,
    onRsvpedOnlyChange,
    mineOnly,
    onMineOnlyChange,
    showHidden,
    onShowHiddenChange,
    hiddenCount,
    allowedTags,
    selectedTags,
    onSelectedTagsChange,
    allowedTracks,
    selectedTrackIds,
    onSelectedTrackIdsChange,
  } = props

  const hasTags =
    allowedTags && allowedTags.length > 0 && !!onSelectedTagsChange
  const hasTracks =
    allowedTracks && allowedTracks.length > 0 && !!onSelectedTrackIdsChange

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <SearchField value={search} onChange={onSearchChange} />
        <ViewSwitcher
          view={view}
          onViewChange={onViewChange}
          className="ml-auto"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <RsvpedToggle
          active={rsvpedOnly}
          onChange={onRsvpedOnlyChange}
          onMutuallyExclusive={() => mineOnly && onMineOnlyChange(false)}
        />
        <MineToggle
          active={mineOnly}
          onChange={onMineOnlyChange}
          onMutuallyExclusive={() => rsvpedOnly && onRsvpedOnlyChange(false)}
        />
        {onShowHiddenChange && (
          <HiddenToggle
            active={!!showHidden}
            onChange={onShowHiddenChange}
            hiddenCount={hiddenCount}
          />
        )}
        {hasTags && (
          <TagsPopover
            allowedTags={allowedTags!}
            selectedTags={selectedTags ?? []}
            onChange={onSelectedTagsChange!}
          />
        )}
        {hasTracks && (
          <TracksPopover
            allowedTracks={allowedTracks!}
            selectedTrackIds={selectedTrackIds ?? []}
            onChange={onSelectedTrackIdsChange!}
          />
        )}
      </div>
    </div>
  )
}
