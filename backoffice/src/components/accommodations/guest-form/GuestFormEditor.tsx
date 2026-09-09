import { closestCenter, DndContext } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { Eye, EyeOff, Info, Plus, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { useListReorder } from "@/components/ticketing-step-builder/template-configs/useListReorder"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { FieldRow } from "./FieldRow"
import { GuestFormPreview } from "./GuestFormPreview"
import {
  CROWDED_AFTER,
  emptyForm,
  formProblem,
  GUEST_FIELD_TYPES,
  type GuestField,
  type GuestFormValue,
  type GuestsMode,
  isEmpty,
  MAX_FIELDS,
  makeField,
  PRESETS,
  takenKeys,
} from "./guestForm"

const GUESTS_MODES: { value: GuestsMode; label: string; hint: string }[] = [
  {
    value: "same_as_booker",
    label: "The same questions",
    hint: "Every guest is asked what the booking contact is asked.",
  },
  {
    value: "custom",
    label: "A shorter set",
    hint: "Ask the other guests only what you need from each of them.",
  },
  {
    value: "off",
    label: "Nothing",
    hint: "Only the booking contact is asked anything.",
  },
]

interface GuestFormEditorProps {
  value: GuestFormValue
  onChange: (next: GuestFormValue) => void
}

/**
 * The guest-details form editor.
 *
 * Lives in `components/accommodations/` rather than under the step builder
 * because it edits a form, not a step: a per-property override would reuse
 * it from the property page unchanged.
 *
 * Two sections, because a booking has two kinds of person in it: whoever the
 * room is for, and everyone else in it. The second section's mode is what
 * keeps the common case cheap, since asking the same questions of everyone
 * should not mean maintaining the list twice.
 */
export function GuestFormEditor({ value, onChange }: GuestFormEditorProps) {
  const [showPreview, setShowPreview] = useState(false)
  // Presets are an opening move, not a state to fall back into: picking
  // "start from scratch" leaves the form empty, and re-offering the presets
  // there would be a door that never opens.
  const [started, setStarted] = useState(() => !isEmpty(value))
  const problem = formProblem(value)

  const setBookerFields = (fields: GuestField[]) =>
    onChange({ ...value, booker: { ...value.booker, fields } })
  const setGuestFields = (fields: GuestField[]) =>
    onChange({ ...value, guests: { ...value.guests, fields } })

  if (!started) {
    return (
      <PresetPicker
        onPick={(form) => {
          setStarted(true)
          onChange(form)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <FieldSection
        title="Booking contact"
        description="Asked once per room, of whoever the room is for. Their name and email are not here: the checkout already has both and files them with the booking."
        fields={value.booker.fields}
        onChange={setBookerFields}
        takenKeys={takenKeys(value)}
      />

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="guests-mode" className="text-sm font-medium">
            Other guests
          </Label>
          <p className="text-xs text-muted-foreground">
            What each additional person in the room is asked.
          </p>
        </div>

        <Select
          value={value.guests.mode}
          onValueChange={(mode) =>
            onChange({
              ...value,
              guests: { ...value.guests, mode: mode as GuestsMode },
            })
          }
        >
          <SelectTrigger id="guests-mode" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUESTS_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          {GUESTS_MODES.find((mode) => mode.value === value.guests.mode)?.hint}
        </p>

        {value.guests.mode === "same_as_booker" &&
          value.booker.fields.length > 0 && (
            <div className="flex flex-col gap-2 opacity-70">
              {value.booker.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  readOnly
                  onChange={() => {}}
                  onRemove={() => {}}
                />
              ))}
            </div>
          )}

        {value.guests.mode === "custom" && (
          <FieldSection
            title=""
            description=""
            fields={value.guests.fields}
            onChange={setGuestFields}
            takenKeys={takenKeys(value)}
          />
        )}
      </div>

      {problem && (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPreview((open) => !open)}
        >
          {showPreview ? (
            <EyeOff className="mr-2 h-3.5 w-3.5" />
          ) : (
            <Eye className="mr-2 h-3.5 w-3.5" />
          )}
          {showPreview ? "Hide preview" : "Preview"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setStarted(false)
            onChange(emptyForm())
          }}
        >
          Clear all questions
        </Button>
      </div>

      {showPreview && <GuestFormPreview form={value} />}
    </div>
  )
}

interface FieldSectionProps {
  title: string
  description: string
  fields: GuestField[]
  onChange: (fields: GuestField[]) => void
  takenKeys: string[]
}

function FieldSection({
  title,
  description,
  fields,
  onChange,
  takenKeys: taken,
}: FieldSectionProps) {
  const { sensors, handleDragEnd } = useListReorder(
    fields,
    onChange,
    (field) => field.key,
  )
  const full = fields.length >= MAX_FIELDS

  return (
    <div
      className={cn("flex flex-col gap-3", title && "rounded-lg border p-4")}
    >
      {title && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{title}</span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      )}

      {fields.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={fields.map((field) => field.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {fields.map((field, index) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  onChange={(next) =>
                    onChange(fields.map((f, i) => (i === index ? next : f)))
                  }
                  onRemove={() =>
                    onChange(fields.filter((_, i) => i !== index))
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit" disabled={full}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add question
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {GUEST_FIELD_TYPES.map((type) => (
            <DropdownMenuItem
              key={type.value}
              onSelect={() =>
                onChange([...fields, makeField(type.value, type.label, taken)])
              }
            >
              <type.icon className="mr-2 h-4 w-4" />
              {type.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {fields.length > CROWDED_AFTER && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {fields.length} questions. Every one of them is another thing between
          a buyer and a booked room.
        </p>
      )}
    </div>
  )
}

function PresetPicker({ onPick }: { onPick: (form: GuestFormValue) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The buyer's name and email already reach the property with the booking,
        so nothing here needs to ask for them. Start from one of these, or build
        your own.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPick(preset.build())}
            className="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent/40"
          >
            <span className="text-sm font-medium">{preset.label}</span>
            <span className="text-xs text-muted-foreground">
              {preset.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
