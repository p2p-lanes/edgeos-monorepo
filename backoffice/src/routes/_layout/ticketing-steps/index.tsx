import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useMemo, useState } from "react"

import { type TicketingStepPublic, TicketingStepsService } from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { AddStepDialog } from "@/components/ticketing-step-builder/AddStepDialog"
import { StepCanvas } from "@/components/ticketing-step-builder/StepCanvas"
import { StepConfigPanel } from "@/components/ticketing-step-builder/StepConfigPanel"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/ticketing-steps/")({
  component: TicketingStepsPage,
  head: () => ({
    meta: [{ title: "Ticketing Steps - EdgeOS" }],
  }),
})

function TicketingStepsPage() {
  const { isAdmin } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()

  if (!isContextReady) {
    return (
      <div className="flex flex-col gap-6">
        <WorkspaceAlert resource="ticketing steps" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Ticketing Steps</h1>
        <p className="text-muted-foreground">
          You need admin permissions to configure ticketing steps.
        </p>
      </div>
    )
  }

  return <TicketingStepsContent popupId={selectedPopupId!} />
}

function TicketingStepsContent({ popupId }: { popupId: string }) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const [selectedStep, setSelectedStep] = useState<TicketingStepPublic | null>(
    null,
  )
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null)

  const { data: stepsData, isLoading } = useQuery({
    queryKey: ["ticketing-steps", popupId],
    queryFn: () =>
      TicketingStepsService.listTicketingSteps({
        popupId,
        limit: 100,
      }),
  })

  const steps = useMemo(() => {
    if (!stepsData?.results) return []
    return [...stepsData.results].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [stepsData])

  const orderedSteps = useMemo(() => {
    if (!liveOrder) return steps
    return liveOrder
      .map((id) => steps.find((s) => s.id === id))
      .filter(Boolean) as TicketingStepPublic[]
  }, [steps, liveOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const updateStepMutation = useMutation({
    mutationFn: (data: { stepId: string; order: number }) =>
      TicketingStepsService.updateTicketingStep({
        stepId: data.stepId,
        requestBody: { order: data.order },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const persistStepOrder = (orderedIds: string[]) => {
    const previousOrder = steps.map((s) => s.id)
    orderedIds.forEach((stepId, index) => {
      if (previousOrder[index] !== stepId) {
        updateStepMutation.mutate({ stepId, order: index })
      }
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) {
      setLiveOrder(null)
      return
    }

    const currentOrder = liveOrder ?? steps.map((s) => s.id)
    const oldIndex = currentOrder.indexOf(String(active.id))
    const newIndex = currentOrder.indexOf(String(over.id))

    if (oldIndex === -1 || newIndex === -1) {
      setLiveOrder(null)
      return
    }

    const reordered = arrayMove(currentOrder, oldIndex, newIndex)
    setLiveOrder(null)
    persistStepOrder(reordered)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const currentOrder = liveOrder ?? steps.map((s) => s.id)
    const oldIndex = currentOrder.indexOf(String(active.id))
    const newIndex = currentOrder.indexOf(String(over.id))

    if (oldIndex === -1 || newIndex === -1) return
    setLiveOrder(arrayMove(currentOrder, oldIndex, newIndex))
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ticketing Steps</h1>
          <p className="text-muted-foreground">
            Configure the checkout flow for your event
          </p>
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ticketing Steps</h1>
          <p className="text-muted-foreground">
            Drag to reorder steps, toggle to enable/disable, click the title to
            rename
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>+ Add Step</Button>
      </div>

      <div className="max-w-xl">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <StepCanvas steps={orderedSteps} onEdit={setSelectedStep} />
        </DndContext>
      </div>

      {updateStepMutation.isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      )}

      <Sheet
        open={!!selectedStep}
        onOpenChange={(open) => {
          if (!open) setSelectedStep(null)
        }}
      >
        {selectedStep && (
          <StepConfigPanel
            step={selectedStep}
            onClose={() => setSelectedStep(null)}
          />
        )}
      </Sheet>

      <AddStepDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        popupId={popupId}
        nextOrder={orderedSteps.length}
      />
    </div>
  )
}
