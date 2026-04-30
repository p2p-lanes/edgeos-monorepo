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
  buildPayload: (
    timezone: string,
    startIso: string,
    endIso: string,
  ) => EventUpdate
}

export function useEditEventForm(event: EventPublic): UseEditEventFormResult {
  const [title, setTitle] = useState(() => event.title ?? "")
  const [content, setContent] = useState(() => event.content ?? "")
  const [venueId, setVenueId] = useState(() => event.venue_id ?? "")
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

  const buildPayload = (
    timezone: string,
    startIso: string,
    endIso: string,
  ): EventUpdate => ({
    title: title.trim(),
    content: content.trim() || null,
    start_time: startIso,
    end_time: endIso,
    timezone: timezone || "UTC",
    venue_id: venueId || null,
    track_id: trackId || null,
    visibility,
    max_participant: maxParticipants
      ? Math.max(0, Number.parseInt(maxParticipants, 10))
      : null,
    meeting_url: meetingUrl || null,
    cover_url: coverUrl || null,
    tags,
  })

  return {
    title,
    setTitle,
    content,
    setContent,
    venueId,
    setVenueId,
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
    buildPayload,
  }
}
