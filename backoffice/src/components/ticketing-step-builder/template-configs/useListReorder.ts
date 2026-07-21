import {
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"

// Shared dnd-kit reorder wiring for the id-keyed sortable lists in the
// template-config editors. Handlers that reindex an `order` field or resolve
// ids by numeric index deliberately keep their own handleDragEnd.
export function useListReorder<T>(
  items: T[],
  onReorder: (reordered: T[]) => void,
  getId: (item: T) => string,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((item) => getId(item) === active.id)
    const newIndex = items.findIndex((item) => getId(item) === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(items, oldIndex, newIndex))
  }

  return { sensors, handleDragEnd }
}
