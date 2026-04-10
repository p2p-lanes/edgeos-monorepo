import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, GripVertical, HelpCircle, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FaqItem {
  id: string
  question: string
  answer: string
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const FAQ_VARIANTS = [
  {
    value: "accordion",
    label: "Accordion",
    description: "Click to expand each question",
  },
  {
    value: "list",
    label: "List",
    description: "Always-open vertical list",
  },
  {
    value: "two-column",
    label: "Two Column",
    description: "Side-by-side cards on desktop",
  },
  {
    value: "cards",
    label: "Cards",
    description: "Elevated card per question",
  },
] as const

// ---------------------------------------------------------------------------
// Variant previews
// ---------------------------------------------------------------------------

function AccordionPreview() {
  return (
    <div className="flex flex-col gap-0.5 w-full">
      <div className="h-2.5 rounded-sm bg-muted-foreground/20" />
      <div className="h-2.5 rounded-sm bg-muted-foreground/10" />
      <div className="h-2.5 rounded-sm bg-muted-foreground/10" />
    </div>
  )
}

function ListPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex flex-col gap-0.5">
        <div className="h-1.5 w-3/5 rounded-sm bg-muted-foreground/25" />
        <div className="h-1 w-full rounded-sm bg-muted-foreground/10" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="h-1.5 w-2/5 rounded-sm bg-muted-foreground/25" />
        <div className="h-1 w-full rounded-sm bg-muted-foreground/10" />
      </div>
    </div>
  )
}

function TwoColumnPreview() {
  return (
    <div className="grid grid-cols-2 gap-0.5 w-full">
      <div className="rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="h-1 w-3/4 rounded-sm bg-muted-foreground/25 mb-0.5" />
        <div className="h-0.5 w-full rounded-sm bg-muted-foreground/15" />
      </div>
      <div className="rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="h-1 w-3/4 rounded-sm bg-muted-foreground/25 mb-0.5" />
        <div className="h-0.5 w-full rounded-sm bg-muted-foreground/15" />
      </div>
    </div>
  )
}

function CardsPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-1 rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
        <div className="flex-1 h-1 rounded-sm bg-muted-foreground/20" />
      </div>
      <div className="flex items-center gap-1 rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
        <div className="flex-1 h-1 rounded-sm bg-muted-foreground/20" />
      </div>
    </div>
  )
}

const VARIANT_PREVIEW_MAP: Record<string, React.FC> = {
  accordion: AccordionPreview,
  list: ListPreview,
  "two-column": TwoColumnPreview,
  cards: CardsPreview,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseItems(config: Record<string, unknown> | null): FaqItem[] {
  if (!config || !Array.isArray(config.items)) return []
  return config.items as FaqItem[]
}

// ---------------------------------------------------------------------------
// Sortable FAQ card
// ---------------------------------------------------------------------------

function SortableFaqCard({
  item,
  onUpdateQuestion,
  onUpdateAnswer,
  onDelete,
}: {
  item: FaqItem
  onUpdateQuestion: (id: string, question: string) => void
  onUpdateAnswer: (id: string, answer: string) => void
  onDelete: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-lg border bg-background p-2 shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground shrink-0 mt-2"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <Input
          value={item.question}
          onChange={(e) => onUpdateQuestion(item.id, e.target.value)}
          placeholder="Question"
          className="h-8 text-sm"
        />
        <Textarea
          value={item.answer}
          onChange={(e) => onUpdateAnswer(item.id, e.target.value)}
          placeholder="Answer"
          className="text-sm min-h-16"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-1"
        onClick={() => onDelete(item.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FaqsConfig({ config, onChange }: TemplateConfigProps) {
  const variant = (config?.variant as string) || "accordion"
  const title = (config?.title as string) || ""
  const items = parseItems(config)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const updateItems = (updated: FaqItem[]) => {
    onChange({ ...config, items: updated })
  }

  const handleAddItem = () => {
    const newItem: FaqItem = {
      id: crypto.randomUUID(),
      question: "",
      answer: "",
    }
    updateItems([...items, newItem])
  }

  const handleUpdateQuestion = (id: string, question: string) => {
    updateItems(
      items.map((item) => (item.id === id ? { ...item, question } : item)),
    )
  }

  const handleUpdateAnswer = (id: string, answer: string) => {
    updateItems(
      items.map((item) => (item.id === id ? { ...item, answer } : item)),
    )
  }

  const handleDeleteItem = (id: string) => {
    updateItems(items.filter((item) => item.id !== id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    updateItems(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Variant selector */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">FAQ Layout</Label>
          <p className="text-xs text-muted-foreground">
            Choose how questions are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FAQ_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = VARIANT_PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    variant: v.value === "accordion" ? undefined : v.value,
                  })
                }
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </div>
                )}
                <div className="w-full px-1">
                  <Preview />
                </div>
                <div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      isActive && "text-primary",
                    )}
                  >
                    {v.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {v.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Separator />

      {/* Section title */}
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Section Title (optional)</Label>
        <Input
          value={title}
          onChange={(e) =>
            onChange({
              ...config,
              title: e.target.value || undefined,
            })
          }
          placeholder="Frequently Asked Questions"
        />
      </div>

      <Separator />

      {/* Questions list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <Label className="text-sm font-medium">
              Questions ({items.length})
            </Label>
            <p className="text-xs text-muted-foreground">
              Add and reorder questions visitors will see
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddItem}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Question
          </Button>
        </div>

        {items.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <SortableFaqCard
                    key={item.id}
                    item={item}
                    onUpdateQuestion={handleUpdateQuestion}
                    onUpdateAnswer={handleUpdateAnswer}
                    onDelete={handleDeleteItem}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <HelpCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No questions added yet. Click "Add Question" to start.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
