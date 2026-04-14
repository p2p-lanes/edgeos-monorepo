import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as LucideIcons from "lucide-react"
import {
  Calendar,
  Clock,
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import type { ComponentType } from "react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  type EventVenueCreate,
  type EventVenuePublic,
  EventVenuesService,
  type VenueBookingMode,
  type VenueExceptionPublic,
  type VenuePropertyTypePublic,
  type VenueWeeklyHourInput,
  type VenueWeeklyHourRef,
  VenuePropertyTypesService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { TimePicker } from "@/components/ui/time-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { useFileUpload } from "@/hooks/useFileUpload"
import { createErrorHandler } from "@/utils"

interface VenueFormProps {
  defaultValues?: EventVenuePublic
  onSuccess: () => void
}

// Booking mode options
const BOOKING_MODE_OPTIONS: { value: VenueBookingMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "approval_required", label: "Approval required" },
  { value: "unbookable", label: "Unbookable" },
]

// Days of week (backend: 0 = Monday ... 6 = Sunday)
const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Monday", short: "Mon" },
  { value: 1, label: "Tuesday", short: "Tue" },
  { value: 2, label: "Wednesday", short: "Wed" },
  { value: 3, label: "Thursday", short: "Thu" },
  { value: 4, label: "Friday", short: "Fri" },
  { value: 5, label: "Saturday", short: "Sat" },
  { value: 6, label: "Sunday", short: "Sun" },
]

const MAX_PHOTOS = 10

/**
 * Extract latitude and longitude from a Google Maps URL.
 *
 * Supports:
 * - https://www.google.com/maps/place/.../@-34.6037,-58.3816,17z/...
 * - https://www.google.com/maps?q=-34.6037,-58.3816
 * - https://maps.google.com/?ll=-34.6037,-58.3816
 * - https://www.google.com/maps/@-34.6037,-58.3816,17z
 * - URLs with !3d (lat) and !4d (lng) params
 */
function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null
  try {
    const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (atMatch) {
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
    }
    const qMatch = url.match(/[?&](?:q|ll)=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (qMatch) {
      return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
    }
    const dMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/)
    if (dMatch) {
      return { lat: parseFloat(dMatch[1]), lng: parseFloat(dMatch[2]) }
    }
  } catch {
    // ignore parse errors
  }
  return null
}

/** Check if URL is a Google Maps short link (goo.gl, maps.app.goo.gl) */
function isShortMapsLink(url: string): boolean {
  return /^https?:\/\/(goo\.gl|maps\.app\.goo\.gl)\//.test(url)
}

async function resolveShortLink(url: string): Promise<string | null> {
  try {
    const baseUrl = import.meta.env.VITE_API_URL || ""
    const res = await fetch(
      `${baseUrl}/api/v1/utils/resolve-url?url=${encodeURIComponent(url)}`,
    )
    if (res.ok) {
      const data = await res.json()
      return data.resolved_url ?? null
    }
  } catch {
    // Fallback: ignore
  }
  return null
}

// ---- Gallery ----

interface GallerySectionProps {
  venueId: string
}

function GallerySection({ venueId }: GallerySectionProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const { uploadFile, isUploading } = useFileUpload()

  const { data: photos = [] } = useQuery({
    queryKey: ["event-venues", venueId, "photos"],
    queryFn: () => EventVenuesService.listPhotos({ venueId }),
  })

  const addPhotoMutation = useMutation({
    mutationFn: (image_url: string) =>
      EventVenuesService.addPhoto({
        venueId,
        requestBody: { image_url, position: photos.length },
      }),
    onSuccess: () => {
      showSuccessToast("Photo added")
      queryClient.invalidateQueries({
        queryKey: ["event-venues", venueId, "photos"],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) =>
      EventVenuesService.deletePhoto({ venueId, photoId }),
    onSuccess: () => {
      showSuccessToast("Photo removed")
      queryClient.invalidateQueries({
        queryKey: ["event-venues", venueId, "photos"],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleFile = async (file: File) => {
    try {
      const { publicUrl } = await uploadFile(file)
      addPhotoMutation.mutate(publicUrl)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Upload failed")
    }
  }

  const isAtMax = photos.length >= MAX_PHOTOS

  return (
    <InlineSection title="Gallery">
      <div className="space-y-3 py-3">
        <p className="text-xs text-muted-foreground">
          {photos.length}/{MAX_PHOTOS} photos. Changes save immediately.
        </p>
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative h-24 w-24 overflow-hidden rounded-md border"
            >
              <img
                src={photo.image_url}
                alt="Gallery"
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={() => deletePhotoMutation.mutate(photo.id)}
                disabled={deletePhotoMutation.isPending}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading || isAtMax}
            className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Add photo"
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-xs">Add photo</span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ""
            }}
          />
        </div>
        {isAtMax && (
          <p className="text-xs text-muted-foreground">
            Maximum number of photos reached.
          </p>
        )}
      </div>
    </InlineSection>
  )
}

// ---- Property types picker ----

interface PropertyPickerProps {
  value: string[]
  onChange: (ids: string[]) => void
}

function PropertyPicker({ value, onChange }: PropertyPickerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("")
  const [pendingDelete, setPendingDelete] =
    useState<VenuePropertyTypePublic | null>(null)

  const { data: propertyTypes = [] } = useQuery<VenuePropertyTypePublic[]>({
    queryKey: ["venue-property-types"],
    queryFn: () => VenuePropertyTypesService.listPropertyTypes(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      VenuePropertyTypesService.createPropertyType({
        requestBody: { name: newName.trim(), icon: newIcon.trim() || null },
      }),
    onSuccess: (created) => {
      showSuccessToast("Property type created")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      if (created?.id) onChange([...value, created.id])
      setNewName("")
      setNewIcon("")
      setShowNew(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (propertyTypeId: string) =>
      VenuePropertyTypesService.deletePropertyType({ propertyTypeId }),
    onSuccess: (_, propertyTypeId) => {
      showSuccessToast("Property type deleted")
      queryClient.invalidateQueries({ queryKey: ["venue-property-types"] })
      onChange(value.filter((v) => v !== propertyTypeId))
      setPendingDelete(null)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <InlineSection title="Properties">
      <div className="space-y-3 py-3">
        {propertyTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No property types yet. Create one below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {propertyTypes.map((pt) => {
              const selected = value.includes(pt.id)
              return (
                <div
                  key={pt.id}
                  className="group relative inline-flex"
                >
                  <button
                    type="button"
                    onClick={() => toggle(pt.id)}
                    aria-pressed={selected}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 pr-6 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (selected
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")
                    }
                  >
                    <LucideIconByName
                      name={pt.icon}
                      className="h-3.5 w-3.5"
                    />
                    <span>{pt.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${pt.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(pt)
                    }}
                    className={
                      "absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none " +
                      (selected
                        ? "text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/20"
                        : "text-muted-foreground hover:text-destructive hover:bg-destructive/10")
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {showNew ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex-1 min-w-[160px] space-y-1">
              <Label htmlFor="new-property-name">Name</Label>
              <Input
                id="new-property-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Projector, Wi-Fi, Parking..."
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="new-property-icon">Icon (optional)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      aria-label="Icon help"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    PascalCase lucide name (Mic, Monitor, Armchair, Wifi…).
                    Browse at{" "}
                    <a
                      href="https://lucide.dev/icons/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      lucide.dev/icons
                    </a>
                    .
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="new-property-icon"
                value={newIcon}
                onChange={(e) => setNewIcon(e.target.value)}
                placeholder="Mic"
              />
            </div>
            <div className="flex gap-2">
              <LoadingButton
                type="button"
                size="sm"
                loading={createMutation.isPending}
                disabled={!newName.trim()}
                onClick={() => createMutation.mutate()}
              >
                Create
              </LoadingButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNew(false)
                  setNewName("")
                  setNewIcon("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowNew(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New property type
          </Button>
        )}
      </div>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete property type</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Remove "${pendingDelete.name}" from the tenant catalog? Any venue currently referencing it will lose this property. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete.id)
              }
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InlineSection>
  )
}

// ---- Weekly hours ----

interface WeeklyHoursEditorProps {
  venueId: string
  initial: VenueWeeklyHourRef[] | undefined
}

function buildInitialWeek(
  initial: VenueWeeklyHourRef[] | undefined,
): VenueWeeklyHourInput[] {
  return DAYS_OF_WEEK.map((day) => {
    const existing = initial?.find((h) => h.day_of_week === day.value)
    if (existing) {
      return {
        day_of_week: day.value,
        open_time: existing.open_time ?? "09:00",
        close_time: existing.close_time ?? "17:00",
        is_closed: existing.is_closed,
      }
    }
    return {
      day_of_week: day.value,
      open_time: "09:00",
      close_time: "17:00",
      is_closed: true,
    }
  })
}

function WeeklyHoursEditor({ venueId, initial }: WeeklyHoursEditorProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [hours, setHours] = useState<VenueWeeklyHourInput[]>(() =>
    buildInitialWeek(initial),
  )

  useEffect(() => {
    setHours(buildInitialWeek(initial))
  }, [initial])

  const saveMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.setWeeklyHours({
        venueId,
        requestBody: { hours },
      }),
    onSuccess: () => {
      showSuccessToast("Weekly hours saved")
      queryClient.invalidateQueries({ queryKey: ["event-venues", venueId] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateDay = (
    day: number,
    patch: Partial<VenueWeeklyHourInput>,
  ) => {
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, ...patch } : h)),
    )
  }

  return (
    <InlineSection title="Weekly hours">
      <div className="space-y-2 py-3">
        {DAYS_OF_WEEK.map((day) => {
          const entry = hours.find((h) => h.day_of_week === day.value)!
          return (
            <div
              key={day.value}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2 w-24 shrink-0">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{day.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`closed-${day.value}`}
                  checked={!entry.is_closed}
                  onCheckedChange={(checked) =>
                    updateDay(day.value, { is_closed: !checked })
                  }
                />
                <Label
                  htmlFor={`closed-${day.value}`}
                  className="text-xs text-muted-foreground"
                >
                  {entry.is_closed ? "Closed" : "Open"}
                </Label>
              </div>
              {!entry.is_closed && (
                <div className="flex items-center gap-2">
                  <TimePicker
                    value={entry.open_time ?? ""}
                    onChange={(v) => updateDay(day.value, { open_time: v })}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <TimePicker
                    value={entry.close_time ?? ""}
                    onChange={(v) => updateDay(day.value, { close_time: v })}
                  />
                </div>
              )}
            </div>
          )
        })}
        <div className="flex justify-end pt-2">
          <LoadingButton
            type="button"
            size="sm"
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Save weekly hours
          </LoadingButton>
        </div>
      </div>
    </InlineSection>
  )
}

// ---- Exceptions ----

interface ExceptionsEditorProps {
  venueId: string
}

interface ExceptionDialogState {
  open: boolean
  editing: VenueExceptionPublic | null
  start_datetime: string
  end_datetime: string
  reason: string
  is_closed: boolean
}

const EMPTY_EXCEPTION: ExceptionDialogState = {
  open: false,
  editing: null,
  start_datetime: "",
  end_datetime: "",
  reason: "",
  is_closed: true,
}

function toLocalDateTimeString(iso: string | null | undefined): string {
  if (!iso) return ""
  // Accept both ISO with Z/offset and local naive — return YYYY-MM-DDTHH:mm
  // Treat as local display value for the DateTimePicker.
  return iso.slice(0, 16)
}

function ExceptionsEditor({ venueId }: ExceptionsEditorProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [state, setState] = useState<ExceptionDialogState>(EMPTY_EXCEPTION)

  const { data: exceptions = [] } = useQuery({
    queryKey: ["event-venues", venueId, "exceptions"],
    queryFn: () => EventVenuesService.listExceptions({ venueId }),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["event-venues", venueId, "exceptions"],
    })

  const createMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.createException({
        venueId,
        requestBody: {
          start_datetime: new Date(state.start_datetime).toISOString(),
          end_datetime: new Date(state.end_datetime).toISOString(),
          reason: state.reason || null,
          is_closed: state.is_closed,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Exception added")
      invalidate()
      setState(EMPTY_EXCEPTION)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.updateException({
        venueId,
        exceptionId: state.editing!.id,
        requestBody: {
          start_datetime: new Date(state.start_datetime).toISOString(),
          end_datetime: new Date(state.end_datetime).toISOString(),
          reason: state.reason || null,
          is_closed: state.is_closed,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Exception updated")
      invalidate()
      setState(EMPTY_EXCEPTION)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (exceptionId: string) =>
      EventVenuesService.deleteException({ venueId, exceptionId }),
    onSuccess: () => {
      showSuccessToast("Exception removed")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const openAdd = () =>
    setState({
      open: true,
      editing: null,
      start_datetime: "",
      end_datetime: "",
      reason: "",
      is_closed: true,
    })

  const openEdit = (exc: VenueExceptionPublic) =>
    setState({
      open: true,
      editing: exc,
      start_datetime: toLocalDateTimeString(exc.start_datetime),
      end_datetime: toLocalDateTimeString(exc.end_datetime),
      reason: exc.reason ?? "",
      is_closed: exc.is_closed,
    })

  const save = () => {
    if (!state.start_datetime || !state.end_datetime) {
      showErrorToast("Start and end datetimes are required")
      return
    }
    if (state.editing) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending

  const formatRange = (exc: VenueExceptionPublic) => {
    const s = new Date(exc.start_datetime)
    const e = new Date(exc.end_datetime)
    return `${s.toLocaleString()} → ${e.toLocaleString()}`
  }

  return (
    <InlineSection title="Exceptions">
      <div className="space-y-2 py-3">
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exceptions. Add one to override weekly hours on specific dates.
          </p>
        ) : (
          <ul className="space-y-2">
            {exceptions.map((exc) => (
              <li
                key={exc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      {formatRange(exc)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={exc.is_closed ? "destructive" : "secondary"}>
                        {exc.is_closed ? "Closed" : "Open"}
                      </Badge>
                      {exc.reason && <span>{exc.reason}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Edit exception"
                    onClick={() => openEdit(exc)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete exception"
                    onClick={() => deleteMutation.mutate(exc.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add exception
          </Button>
        </div>
      </div>

      <Dialog
        open={state.open}
        onOpenChange={(open) =>
          setState((prev) => ({ ...prev, open: open ? prev.open : false }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {state.editing ? "Edit exception" : "New exception"}
            </DialogTitle>
            <DialogDescription>
              Overrides weekly hours on a specific date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <DateTimePicker
                value={state.start_datetime}
                onChange={(v) =>
                  setState((prev) => ({ ...prev, start_datetime: v }))
                }
                placeholder="Select start date"
              />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <DateTimePicker
                value={state.end_datetime}
                onChange={(v) =>
                  setState((prev) => ({ ...prev, end_datetime: v }))
                }
                placeholder="Select end date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exception-reason">Reason</Label>
              <Textarea
                id="exception-reason"
                value={state.reason}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, reason: e.target.value }))
                }
                rows={2}
                placeholder="Holiday, maintenance, special event..."
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="exception-closed">Closed</Label>
              <Switch
                id="exception-closed"
                checked={state.is_closed}
                onCheckedChange={(checked) =>
                  setState((prev) => ({ ...prev, is_closed: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setState(EMPTY_EXCEPTION)}
            >
              Cancel
            </Button>
            <LoadingButton type="button" loading={saving} onClick={save}>
              {state.editing ? "Save" : "Create"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InlineSection>
  )
}

// ---- Main form ----

export function VenueForm({ defaultValues, onSuccess }: VenueFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventVenuesService.createVenue({ requestBody: data as EventVenueCreate }),
    onSuccess: () => {
      showSuccessToast("Venue created successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventVenuesService.updateVenue({
        venueId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Venue updated successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const buildMapsLink = (lat: number | null, lng: number | null) => {
    if (lat != null && lng != null) {
      return `https://www.google.com/maps/@${lat},${lng},17z`
    }
    return ""
  }

  const initialPropertyIds = useMemo(
    () => defaultValues?.properties?.map((p) => p.id) ?? [],
    [defaultValues],
  )

  // Existing tag / amenity suggestions — pulled from other venues in the
  // current popup so the author can pick from values already in use.
  const { data: popupVenues } = useQuery({
    queryKey: ["event-venues", { popupId: selectedPopupId, limit: 200 }],
    queryFn: () =>
      EventVenuesService.listVenues({ popupId: selectedPopupId!, limit: 200 }),
    enabled: !!selectedPopupId,
  })
  const existingTags = useMemo(
    () =>
      Array.from(
        new Set(
          (popupVenues?.results ?? []).flatMap((v) => v.tags ?? []),
        ),
      ).sort(),
    [popupVenues],
  )
  const existingAmenities = useMemo(
    () =>
      Array.from(
        new Set(
          (popupVenues?.results ?? []).flatMap((v) => v.amenities ?? []),
        ),
      ).sort(),
    [popupVenues],
  )

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      location: defaultValues?.location ?? "",
      google_maps_link: buildMapsLink(
        defaultValues?.geo_lat ?? null,
        defaultValues?.geo_lng ?? null,
      ),
      capacity: defaultValues?.capacity?.toString() ?? "",
      image_url: defaultValues?.image_url ?? "",
      booking_mode: (defaultValues?.booking_mode ??
        "free") as VenueBookingMode,
      setup_time_minutes: (
        defaultValues?.setup_time_minutes ?? 0
      ).toString(),
      teardown_time_minutes: (
        defaultValues?.teardown_time_minutes ?? 0
      ).toString(),
      property_type_ids: initialPropertyIds,
      tags: (defaultValues?.tags ?? []) as string[],
      amenities: (defaultValues?.amenities ?? []) as string[],
    },
    onSubmit: ({ value }) => {
      if (!selectedPopupId && !isEdit) {
        showErrorToast("Select a pop-up first")
        return
      }
      const coords = parseGoogleMapsUrl(value.google_maps_link)

      const tags = value.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      const amenities = value.amenities
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)

      const payload: Record<string, unknown> = {
        popup_id: selectedPopupId,
        title: value.title,
        location: value.location || null,
        formatted_address: value.location || null,
        geo_lat: coords?.lat ?? null,
        geo_lng: coords?.lng ?? null,
        capacity: value.capacity ? parseInt(value.capacity) : null,
        image_url: value.image_url || null,
        booking_mode: value.booking_mode,
        setup_time_minutes: value.setup_time_minutes
          ? Math.max(0, parseInt(value.setup_time_minutes))
          : 0,
        teardown_time_minutes: value.teardown_time_minutes
          ? Math.max(0, parseInt(value.teardown_time_minutes))
          : 0,
        property_type_ids: value.property_type_ids,
        tags,
        amenities,
      }

      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate(payload)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Track Google Maps link for coordinate preview
  const [mapsLink, setMapsLink] = useState(
    buildMapsLink(
      defaultValues?.geo_lat ?? null,
      defaultValues?.geo_lng ?? null,
    ),
  )
  const [resolving, setResolving] = useState(false)
  const parsedCoords = parseGoogleMapsUrl(mapsLink)

  const handleMapsLinkChange = async (
    url: string,
    fieldChange: (v: string) => void,
  ) => {
    fieldChange(url)
    setMapsLink(url)

    if (isShortMapsLink(url)) {
      setResolving(true)
      const resolved = await resolveShortLink(url)
      if (resolved) {
        fieldChange(resolved)
        setMapsLink(resolved)
      }
      setResolving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="max-w-3xl space-y-8"
    >
      <form.Field name="title">
        {(field) => (
          <HeroInput
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="Venue Name"
          />
        )}
      </form.Field>

      {/* 1. Basic */}
      <InlineSection title="Location">
        <InlineRow label="Address" description="Location description">
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

        <InlineRow
          label="Google Maps Link"
          description="Paste a Google Maps share link to extract coordinates"
        >
          <div className="space-y-1.5">
            <form.Field name="google_maps_link">
              {(field) => (
                <Input
                  value={field.state.value}
                  onChange={(e) =>
                    handleMapsLinkChange(e.target.value, field.handleChange)
                  }
                  placeholder="Paste Google Maps link (share or full URL)"
                />
              )}
            </form.Field>
            {resolving && (
              <p className="text-xs text-muted-foreground">
                Resolving short link...
              </p>
            )}
            {mapsLink && !resolving && (
              <p className="text-xs text-muted-foreground">
                {parsedCoords
                  ? `Coordinates: ${parsedCoords.lat.toFixed(6)}, ${parsedCoords.lng.toFixed(6)}`
                  : isShortMapsLink(mapsLink)
                    ? "Could not resolve short link. Try pasting the full URL from the browser address bar."
                    : "Could not extract coordinates from this link"}
              </p>
            )}
          </div>
        </InlineRow>

        <InlineRow label="Capacity" description="Max number of people">
          <form.Field name="capacity">
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
      </InlineSection>

      {/* 2. Main photo */}
      <InlineSection title="Main photo">
        <div className="py-3">
          <form.Field name="image_url">
            {(field) => (
              <ImageUpload
                value={field.state.value || null}
                onChange={(url) => field.handleChange(url ?? "")}
              />
            )}
          </form.Field>
        </div>
      </InlineSection>

      {/* Gallery (edit mode only) */}
      {isEdit && defaultValues && <GallerySection venueId={defaultValues.id} />}

      {/* 3. Booking */}
      <InlineSection title="Booking">
        <InlineRow
          label="Booking mode"
          description="How participants can book this venue"
        >
          <form.Field name="booking_mode">
            {(field) => (
              <Select
                value={field.state.value}
                onValueChange={(v) =>
                  field.handleChange(v as VenueBookingMode)
                }
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOOKING_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Setup time (minutes)">
          <form.Field name="setup_time_minutes">
            {(field) => (
              <Input
                type="number"
                min={0}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="0"
                className="w-[120px]"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Teardown time (minutes)">
          <form.Field name="teardown_time_minutes">
            {(field) => (
              <Input
                type="number"
                min={0}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="0"
                className="w-[120px]"
              />
            )}
          </form.Field>
        </InlineRow>
        <p className="px-1 py-2 text-xs text-muted-foreground">
          Venue is locked setup_time_minutes before the event start and
          teardown_time_minutes after the end.
        </p>
      </InlineSection>

      {/* 4. Properties */}
      <form.Field name="property_type_ids">
        {(field) => (
          <PropertyPicker
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>

      {/* 5. Weekly hours (edit mode only) */}
      {isEdit && defaultValues && (
        <WeeklyHoursEditor
          venueId={defaultValues.id}
          initial={defaultValues.weekly_hours}
        />
      )}

      {/* 6. Exceptions (edit mode only) */}
      {isEdit && defaultValues && (
        <ExceptionsEditor venueId={defaultValues.id} />
      )}

      {/* 7. Tags + amenities */}
      <InlineSection title="Details">
        <InlineRow
          label="Tags"
          description="Type to search or add new. Enter to confirm."
        >
          <form.Field name="tags">
            {(field) => (
              <ChipsWithSuggestions
                value={field.state.value}
                onChange={field.handleChange}
                suggestions={existingTags}
                placeholder="outdoor, rooftop, lounge"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow
          label="Amenities"
          description="Type to search or add new. Enter to confirm."
        >
          <form.Field name="amenities">
            {(field) => (
              <ChipsWithSuggestions
                value={field.state.value}
                onChange={field.handleChange}
                suggestions={existingAmenities}
                placeholder="wifi, projector, whiteboard"
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <div className="flex justify-end gap-3">
        <LoadingButton type="submit" loading={isPending}>
          {isEdit ? "Save Changes" : "Create Venue"}
        </LoadingButton>
      </div>
    </form>
  )
}

interface ChipsWithSuggestionsProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  placeholder?: string
}

function ChipsWithSuggestions({
  value,
  onChange,
  suggestions,
  placeholder,
}: ChipsWithSuggestionsProps) {
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)

  const normalized = draft.trim().toLowerCase()
  const filtered = useMemo(() => {
    const selected = new Set(value)
    return suggestions
      .filter((s) => !selected.has(s))
      .filter((s) => (normalized ? s.toLowerCase().includes(normalized) : true))
      .slice(0, 8)
  }, [suggestions, value, normalized])

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase()
    if (!tag || value.includes(tag)) {
      setDraft("")
      return
    }
    onChange([...value, tag])
    setDraft("")
  }

  const removeAt = (index: number) => {
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div className="relative w-80">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="opacity-70 hover:opacity-100"
              onClick={() => removeAt(index)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so click on suggestion fires first.
            setTimeout(() => setOpen(false), 120)
            if (draft.trim()) addTag(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addTag(draft)
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              e.preventDefault()
              removeAt(value.length - 1)
            } else if (e.key === "," || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault()
                addTag(draft)
              }
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          <ul className="max-h-48 overflow-auto py-1 text-sm">
            {filtered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="flex w-full items-center px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addTag(s)
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type LucideIconProps = { className?: string }

function toPascalCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("")
}

function LucideIconByName({
  name,
  className,
}: {
  name: string | null | undefined
  className?: string
}) {
  if (!name) return null
  const raw = name.trim()
  if (!raw) return null
  const registry = LucideIcons as unknown as Record<
    string,
    ComponentType<LucideIconProps>
  >
  // Try as-is first (fast path for correct PascalCase), then normalize
  // kebab-case / lowercase / snake_case (how lucide.dev lists them) to
  // PascalCase.
  const candidates = [raw, toPascalCase(raw)]
  for (const key of candidates) {
    const Icon = registry[key]
    if (Icon && typeof Icon === "function") {
      return <Icon className={className} />
    }
  }
  return null
}
