import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"

import type { TicketingStepPublic } from "@/client"
import { SortableStepCard } from "./SortableStepCard"

interface StepCanvasProps {
  steps: TicketingStepPublic[]
  onEdit: (step: TicketingStepPublic) => void
  selectedId?: string
}

export function StepCanvas({ steps, onEdit, selectedId }: StepCanvasProps) {
  const stepIds = steps.map((s) => s.id)

  return (
    <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-2">
        {steps.map((step) => (
          <SortableStepCard
            key={step.id}
            step={step}
            onEdit={onEdit}
            selected={step.id === selectedId}
          />
        ))}
        {steps.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No steps configured.
          </p>
        )}
      </div>
    </SortableContext>
  )
}
