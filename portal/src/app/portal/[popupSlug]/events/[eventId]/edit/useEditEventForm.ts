"use client"

import { useState } from "react"

import type { EventPublic, EventUpdate } from "@/client"

type Visibility = "public" | "private" | "unlisted"

export interface UseEditEventFormResult {
  title: string
  setTitle: (next: string) => void
  content: string
  setContent: (next: string) => void
  venueId: string
  setVenueId: (next: string) => void
  customLocationName: string
  setCustomLocationName: (next: string) => void
  customLocationUrl: string
  setCustomLocationUrl: (next: string) => void
  trackId: string
  setTrackId: (next: string) => void
  visibility: Visibility
  setVisibility: (next: Visibility) => void
  maxParticipants: string
  setMaxParticipants: (next: string) => void
  meetingUrl: string
  setMeetingUrl: (next: string) => void
  coverUrl: string
  setCoverUrl: (next: string) => void
  tags: string[]
  setTags: (next: string[]) => void
  hostDisplayName: string
  setHostDisplayName: (next: string) => void
  hostId: string | null
  setHostId: (next: string | null) => void
  collaboratorIds: string[]
  setCollaboratorIds: (next: string[]) => void
  buildPayload: (
    timezone: string,
    startIso: string,
    endIso: string,
  ) => EventUpdate
}

export function useEditEventForm(event: EventPublic): UseEditEventFormResult {
  const [title, setTitle] = useState(() => event.title ?? "")
  const [content, setContent] = useState(() => event.content ?? "")
  // Seed the dropdown with the matching sentinel when the event has no real
  // venue: "__custom__" keeps the custom-location inputs visible on first
  // paint, "__meeting__" marks a virtual event (an empty value would render
  // the "Where will it happen?" placeholder, which only the create form —
  // where nothing is picked yet — should show).
  const [venueId, setVenueId] = useState(() =>
    event.custom_location_name
      ? "__custom__"
      : (event.venue_id ?? "__meeting__"),
  )
  const [customLocationName, setCustomLocationName] = useState(
    () => event.custom_location_name ?? "",
  )
  const [customLocationUrl, setCustomLocationUrl] = useState(
    () => event.custom_location_url ?? "",
  )
  const [trackId, setTrackId] = useState(() => event.track_id ?? "")
  const [visibility, setVisibility] = useState<Visibility>(
    () => (event.visibility as Visibility) ?? "public",
  )
  const [maxParticipants, setMaxParticipants] = useState(() =>
    event.max_participant != null ? String(event.max_participant) : "",
  )
  const [meetingUrl, setMeetingUrl] = useState(() => event.meeting_url ?? "")
  const [coverUrl, setCoverUrl] = useState(() => event.cover_url ?? "")
  const [tags, setTags] = useState<string[]>(() => event.tags ?? [])
  const [hostDisplayName, setHostDisplayName] = useState(
    () => event.host_display_name ?? "",
  )
  const [hostId, setHostId] = useState<string | null>(
    () => event.host_id ?? null,
  )
  // Seed from the raw ids; the resolved ``event.collaborators`` (name+avatar)
  // are passed straight to the field for chip labels.
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(
    () => event.collaborator_ids ?? [],
  )

  const buildPayload = (
    timezone: string,
    startIso: string,
    endIso: string,
  ): EventUpdate => {
    const isCustom = venueId === "__custom__"
    const isMeeting = venueId === "__meeting__"
    return {
      title: title.trim(),
      content: content.trim() || null,
      start_time: startIso,
      end_time: endIso,
      timezone: timezone || "UTC",
      venue_id: !isCustom && !isMeeting && venueId ? venueId : null,
      custom_location_name: isCustom ? customLocationName.trim() || null : null,
      custom_location_url: isCustom ? customLocationUrl.trim() || null : null,
      track_id: trackId || null,
      visibility,
      max_participant: maxParticipants
        ? Math.max(0, Number.parseInt(maxParticipants, 10))
        : null,
      meeting_url: isMeeting ? meetingUrl || null : null,
      cover_url: coverUrl || null,
      tags,
      host_display_name: hostDisplayName.trim() || null,
      host_id: hostId,
      collaborator_ids: collaboratorIds,
    }
  }

  return {
    title,
    setTitle,
    content,
    setContent,
    venueId,
    setVenueId,
    customLocationName,
    setCustomLocationName,
    customLocationUrl,
    setCustomLocationUrl,
    trackId,
    setTrackId,
    visibility,
    setVisibility,
    maxParticipants,
    setMaxParticipants,
    meetingUrl,
    setMeetingUrl,
    coverUrl,
    setCoverUrl,
    tags,
    setTags,
    hostDisplayName,
    setHostDisplayName,
    hostId,
    setHostId,
    collaboratorIds,
    setCollaboratorIds,
    buildPayload,
  }
}
