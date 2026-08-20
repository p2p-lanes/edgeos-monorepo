import { DndContext } from "@dnd-kit/core"
import { SortableContext } from "@dnd-kit/sortable"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { TicketingStepPublic } from "@/client"
import { SortableStepCard } from "./SortableStepCard"

const baseStep: TicketingStepPublic = {
  id: "step-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  step_type: "buyer",
  title: "Your information",
  order: 0,
  is_enabled: true,
  protected: false,
  template: "buyer-form",
  emoji: null,
}

function renderCard(step: TicketingStepPublic) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <DndContext>
        <SortableContext items={[step.id]}>
          <SortableStepCard step={step} onEdit={() => {}} />
        </SortableContext>
      </DndContext>
    </QueryClientProvider>,
  )
}

describe("SortableStepCard", () => {
  it("renders a literal emoji as text instead of an icon component", () => {
    renderCard({ ...baseStep, emoji: "🎉" })

    expect(screen.getByText("🎉")).toBeVisible()
  })

  it("renders the title for a non-literal step", () => {
    renderCard({ ...baseStep, emoji: "mushroom" })

    expect(
      screen.getByRole("button", { name: "Your information" }),
    ).toBeVisible()
  })
})
