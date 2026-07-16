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
import { GripVertical, HelpCircle, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

// The title + sortable question list, shared by the `faqs` template's own
// editor (FaqsConfig, which adds a layout picker on top) and the per-step
// "FAQs" card on the step page, which writes to `template_config.faqs`. Both
// author the same `{id, question, answer}[]` shape.

export interface FaqItem {
  id: string
  question: string
  answer: string
}

export function parseFaqItems(raw: unknown): FaqItem[] {
  return Array.isArray(raw) ? (raw as FaqItem[]) : []
}

/**
 * The value to store for an edited FAQ block, or `undefined` once it holds
 * nothing — leaving `{items: []}` behind would litter the config, same reason
 * `footer_text` saves as `value || undefined`.
 *
 * A title with no questions is deliberately kept: an organizer who names the
 * section before writing their first question would otherwise watch the field
 * erase itself keystroke by keystroke. The title is also stored untrimmed, or
 * the space in a two-word title would vanish as it's typed; readers trim.
 */
export function buildFaqsValue(
  title: string,
  items: FaqItem[],
): { title?: string; items: FaqItem[] } | undefined {
  if (items.length === 0 && !title.trim()) return undefined
  return { title: title || undefined, items }
}

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

export function FaqItemsEditor({
  title,
  items,
  onChangeTitle,
  onChangeItems,
  titlePlaceholder = "Frequently Asked Questions",
  titleDescription,
}: {
  title: string
  items: FaqItem[]
  onChangeTitle: (title: string) => void
  onChangeItems: (items: FaqItem[]) => void
  titlePlaceholder?: string
  titleDescription?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleAddItem = () => {
    onChangeItems([
      ...items,
      { id: crypto.randomUUID(), question: "", answer: "" },
    ])
  }

  const handleUpdateQuestion = (id: string, question: string) => {
    onChangeItems(
      items.map((item) => (item.id === id ? { ...item, question } : item)),
    )
  }

  const handleUpdateAnswer = (id: string, answer: string) => {
    onChangeItems(
      items.map((item) => (item.id === id ? { ...item, answer } : item)),
    )
  }

  const handleDeleteItem = (id: string) => {
    onChangeItems(items.filter((item) => item.id !== id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    onChangeItems(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Section title */}
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Section Title (optional)</Label>
        <Input
          value={title}
          onChange={(e) => onChangeTitle(e.target.value)}
          placeholder={titlePlaceholder}
        />
        {titleDescription && (
          <p className="text-xs text-muted-foreground">{titleDescription}</p>
        )}
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
