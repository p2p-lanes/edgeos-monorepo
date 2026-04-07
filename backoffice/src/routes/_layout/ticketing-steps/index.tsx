import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { type TicketingStepPublic, TicketingStepsService } from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { AddStepDialog } from "@/components/ticketing-step-builder/AddStepDialog"
import { StepCanvas } from "@/components/ticketing-step-builder/StepCanvas"
import { Button } from "@/components/ui/button"
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
  const navigate = useNavigate()
  const { showErrorToast } = useCustomToast()

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [displayOrder, setDisplayOrder] = useState<string[]>([])

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
    return [...stepsData.results].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    )
  }, [stepsData])

  useEffect(() => {
    setDisplayOrder(steps.map((s) => s.id))
  }, [steps])

  const orderedSteps = useMemo(() => {
    if (!displayOrder.length) return steps
    return displayOrder
      .map((id) => steps.find((s) => s.id === id))
      .filter(Boolean) as TicketingStepPublic[]
  }, [steps, displayOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
    if (!over || active.id === over.id) return

    const oldIndex = displayOrder.indexOf(String(active.id))
    const newIndex = displayOrder.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(displayOrder, oldIndex, newIndex)
    setDisplayOrder(newOrder)
    persistStepOrder(newOrder)
  }

  const handleEdit = (step: TicketingStepPublic) => {
    navigate({
      to: "/ticketing-steps/$stepId",
      params: { stepId: step.id },
    })
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
          onDragEnd={handleDragEnd}
        >
          <StepCanvas steps={orderedSteps} onEdit={handleEdit} />
        </DndContext>
      </div>

      {updateStepMutation.isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      )}

      <AddStepDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        popupId={popupId}
        nextOrder={orderedSteps.length}
        confirmStepId={steps.find((s) => s.step_type === "confirm")?.id}
      />
    </div>
  )
}
