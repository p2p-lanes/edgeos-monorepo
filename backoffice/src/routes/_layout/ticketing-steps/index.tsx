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

import {
  SalesFlowsService,
  type TicketingStepPublic,
  TicketingStepsService,
} from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FlowSelector } from "@/components/ticketing-step-builder/FlowSelector"
import { NewStepPanel } from "@/components/ticketing-step-builder/NewStepPanel"
import { StepCanvas } from "@/components/ticketing-step-builder/StepCanvas"
import { StepDetailPanel } from "@/components/ticketing-step-builder/StepDetailPanel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface TicketingStepsSearch {
  step?: string
  flow?: string
}

export const Route = createFileRoute("/_layout/ticketing-steps/")({
  component: TicketingStepsPage,
  validateSearch: (raw: Record<string, unknown>): TicketingStepsSearch => ({
    ...(typeof raw.step === "string" && raw.step ? { step: raw.step } : {}),
    ...(typeof raw.flow === "string" && raw.flow ? { flow: raw.flow } : {}),
  }),
  head: () => ({
    meta: [{ title: "Ticketing Steps - EdgeOS" }],
  }),
})

function TicketingStepsPage() {
  const { isOperatorOrAbove } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()

  if (!isContextReady) {
    return (
      <div className="flex flex-col gap-6">
        <WorkspaceAlert resource="ticketing steps" />
      </div>
    )
  }

  if (!isOperatorOrAbove) {
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
  const { step, flow: flowParam } = Route.useSearch()
  const { showErrorToast } = useCustomToast()

  const [adding, setAdding] = useState(false)
  const [displayOrder, setDisplayOrder] = useState<string[]>([])

  // sdd/sales-flows slice 8: the step list is flow-scoped. Absent an
  // explicit ?flow= selection, default to the popup's default flow so the
  // builder shows the same list single-flow popups always saw.
  const { data: flowsData } = useQuery({
    queryKey: ["sales-flows", popupId],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
  })
  const defaultFlowId = flowsData?.results.find((f) => f.is_default)?.id
  const activeFlowId = flowParam ?? defaultFlowId

  const { data: stepsData, isLoading } = useQuery({
    queryKey: ["ticketing-steps", popupId, activeFlowId],
    queryFn: () =>
      TicketingStepsService.listTicketingSteps({
        popupId,
        salesFlowId: activeFlowId,
        limit: 100,
      }),
    enabled: !!activeFlowId,
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

  const selectStep = (id: string) => {
    setAdding(false)
    navigate({
      to: "/ticketing-steps",
      search: { step: id, ...(flowParam ? { flow: flowParam } : {}) },
    })
  }

  const clearSelection = () => {
    setAdding(false)
    navigate({
      to: "/ticketing-steps",
      search: flowParam ? { flow: flowParam } : {},
    })
  }

  const startAdding = () => {
    setAdding(true)
    navigate({
      to: "/ticketing-steps",
      search: flowParam ? { flow: flowParam } : {},
    })
  }

  // Switching flows re-scopes the whole step list — clear any selection
  // from the previous flow's list rather than risk pointing at a step id
  // that doesn't belong to the newly selected flow's resolved tier.
  const selectFlow = (flowId: string) => {
    setAdding(false)
    navigate({ to: "/ticketing-steps", search: { flow: flowId } })
  }

  const selectedStep = step ? steps.find((s) => s.id === step) : undefined

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
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* Journey rail */}
      <div className="flex w-full flex-col gap-4 md:w-80 md:max-w-sm md:shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ticketing Steps</h1>
          <p className="text-muted-foreground">
            Drag to reorder steps, toggle to enable/disable, click the title to
            rename
          </p>
        </div>

        <FlowSelector
          popupId={popupId}
          value={activeFlowId}
          onChange={selectFlow}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <StepCanvas
            steps={orderedSteps}
            onEdit={(s) => selectStep(s.id)}
            selectedId={selectedStep?.id}
          />
        </DndContext>

        <Button variant="outline" onClick={startAdding}>
          + Add step
        </Button>
      </div>

      {/* Detail pane */}
      <div className="min-w-0 flex-1">
        {adding && activeFlowId ? (
          <NewStepPanel
            popupId={popupId}
            // The step is created into the flow being viewed, default or
            // not. There is no shared tier to omit into, so the panel waits
            // until the flow list has resolved.
            salesFlowId={activeFlowId}
            nextOrder={orderedSteps.length}
            confirmStepId={steps.find((s) => s.step_type === "confirm")?.id}
            onCreated={(id) => selectStep(id)}
            onCancel={clearSelection}
          />
        ) : selectedStep ? (
          <StepDetailPanel
            key={selectedStep.id}
            stepId={selectedStep.id}
            onClose={clearSelection}
          />
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Select a step to configure it, or add a new one
          </div>
        )}
      </div>

      {updateStepMutation.isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  )
}
