import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  GripVertical,
  Settings2,
  Trash2,
  TriangleAlert,
  UserCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  buyerCoverage,
  CHOICE_TYPES,
  fieldProblem,
  GUEST_FIELD_TYPES,
  type GuestField,
} from "./guestForm"

interface FieldRowProps {
  field: GuestField
  onChange: (next: GuestField) => void
  onRemove: () => void
  /** Read-only rows are how the "same questions" echo is drawn. */
  readOnly?: boolean
}

/**
 * One question in the editor.
 *
 * The label is edited in place because it is the only thing an operator
 * changes often. Everything else lives behind the settings popover, so a
 * five-question form reads as five lines rather than five panels.
 */
export function FieldRow({
  field,
  onChange,
  onRemove,
  readOnly = false,
}: FieldRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.key, disabled: readOnly })
  const problem = fieldProblem(field)
  const takesOptions = CHOICE_TYPES.has(field.type)
  const covered = buyerCoverage(field)

  const set = (patch: Partial<GuestField>) => onChange({ ...field, ...patch })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-2",
        isDragging && "opacity-60 shadow-sm",
        problem && "border-destructive/50",
      )}
    >
      <div className="flex items-center gap-2">
        {readOnly ? (
          <span className="w-6" />
        ) : (
          <button
            type="button"
            aria-label={`Reorder ${field.label || "question"}`}
            className="cursor-grab text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <Select
          value={field.type}
          disabled={readOnly}
          onValueChange={(type) =>
            set({
              type,
              // A type that needs options and has none cannot be saved, so give
              // it a starting pair rather than a validation error.
              options:
                CHOICE_TYPES.has(type) && field.options.length === 0
                  ? ["Option 1", "Option 2"]
                  : field.options,
            })
          }
        >
          <SelectTrigger
            className="w-40 shrink-0"
            aria-label={`Type of ${field.label || "question"}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUEST_FIELD_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={field.label}
          disabled={readOnly}
          aria-label="Question"
          placeholder="What is being asked"
          onChange={(event) => set({ label: event.target.value })}
        />

        <div className="flex shrink-0 items-center gap-2">
          <Label
            htmlFor={`required-${field.key}`}
            className="text-xs text-muted-foreground"
          >
            Required
          </Label>
          <Switch
            id={`required-${field.key}`}
            checked={field.required}
            disabled={readOnly}
            onCheckedChange={(required) => set({ required })}
          />
        </div>

        {!readOnly && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Settings for ${field.label || "question"}`}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`placeholder-${field.key}`}>
                      Placeholder
                    </Label>
                    <Input
                      id={`placeholder-${field.key}`}
                      value={field.placeholder ?? ""}
                      onChange={(event) =>
                        set({ placeholder: event.target.value || null })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`help-${field.key}`}>Help text</Label>
                    <Input
                      id={`help-${field.key}`}
                      value={field.help_text ?? ""}
                      placeholder="Shown under the field"
                      onChange={(event) =>
                        set({ help_text: event.target.value || null })
                      }
                    />
                  </div>

                  {takesOptions && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`options-${field.key}`}>Options</Label>
                      <Textarea
                        id={`options-${field.key}`}
                        rows={4}
                        value={field.options.join("\n")}
                        onChange={(event) =>
                          set({
                            options: event.target.value
                              .split("\n")
                              .map((option) => option.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        One per line.
                      </p>
                    </div>
                  )}

                  {field.type === "number" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`min-${field.key}`}>Minimum</Label>
                        <Input
                          id={`min-${field.key}`}
                          type="number"
                          value={String(field.config.min ?? "")}
                          onChange={(event) =>
                            set({
                              config: withBound(
                                field.config,
                                "min",
                                event.target.value,
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`max-${field.key}`}>Maximum</Label>
                        <Input
                          id={`max-${field.key}`}
                          type="number"
                          value={String(field.config.max ?? "")}
                          onChange={(event) =>
                            set({
                              config: withBound(
                                field.config,
                                "max",
                                event.target.value,
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Answers are stored under{" "}
                    <code className="font-mono">{field.key}</code>, which does
                    not change when you rename the question.
                  </p>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${field.label || "question"}`}
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}

        {problem && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-destructive"
            title={problem}
          >
            <TriangleAlert className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {covered && (
        /* Not an error, and not a reason to refuse the field: the answer
           still reaches the property, it is just not typed a second time.
           Saying so here is what stops an operator adding an email question,
           previewing the step, and concluding the form is broken. */
        <p className="flex items-start gap-1.5 px-1 pb-0.5 text-xs text-muted-foreground">
          <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {covered === "always"
            ? "The checkout already asks the buyer for this, so it is not shown here twice. Their answer still reaches the property."
            : "Not shown here if your buyer form already asks the buyer for a phone number. Their answer still reaches the property."}
        </p>
      )}
    </div>
  )
}

/** An empty bound is "no bound", not zero. */
function withBound(
  config: Record<string, unknown>,
  bound: "min" | "max",
  raw: string,
): Record<string, unknown> {
  const next = { ...config }
  if (raw.trim() === "") {
    delete next[bound]
  } else {
    next[bound] = Number(raw)
  }
  return next
}
