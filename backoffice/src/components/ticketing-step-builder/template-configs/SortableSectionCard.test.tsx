import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { ProductSection } from "./SortableSectionCard"
import { SortableSectionCard } from "./SortableSectionCard"

// DnD context mock — SortableSectionCard uses useSortable internally
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}))

// ImageUpload is irrelevant for these tests
vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: () => null,
}))

function makeSection(overrides: Partial<ProductSection> = {}): ProductSection {
  return {
    key: "test-section",
    label: "Test Section",
    order: 0,
    product_ids: [],
    ...overrides,
  }
}

function renderCard(
  section: ProductSection,
  onUpdate = vi.fn(),
  onDelete = vi.fn(),
) {
  return render(
    <SortableSectionCard
      section={section}
      onUpdate={onUpdate}
      onDelete={onDelete}
      products={[]}
      showAttendeeCategories={true}
      showMediaFields={false}
    />,
  )
}

describe("SortableSectionCard — attendee category checkboxes", () => {
  it("renders 3 checkboxes labelled Main, Spouse, Kid", () => {
    renderCard(makeSection())
    expect(screen.getByLabelText("Main")).toBeInTheDocument()
    expect(screen.getByLabelText("Spouse")).toBeInTheDocument()
    expect(screen.getByLabelText("Kid")).toBeInTheDocument()
  })

  it("null attendee_categories: all 3 checkboxes unchecked and 'Visible to all attendees' hint shown", () => {
    renderCard(makeSection({ attendee_categories: null }))

    const mainCb = screen.getByLabelText("Main")
    const spouseCb = screen.getByLabelText("Spouse")
    const kidCb = screen.getByLabelText("Kid")

    // Radix Checkbox reflects checked state via data-state attribute
    expect(mainCb).toHaveAttribute("data-state", "unchecked")
    expect(spouseCb).toHaveAttribute("data-state", "unchecked")
    expect(kidCb).toHaveAttribute("data-state", "unchecked")

    expect(screen.getByText("Visible to all attendees")).toBeInTheDocument()
  })

  it("clicking Main alone calls onUpdate with attendee_categories: ['main']", async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    renderCard(makeSection({ attendee_categories: null }), onUpdate)

    await user.click(screen.getByLabelText("Main"))

    expect(onUpdate).toHaveBeenCalledWith("test-section", {
      attendee_categories: ["main"],
    })
  })

  it("checking all 3 calls onUpdate with attendee_categories: null (collapse rule)", async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    // Start with 2 checked (main, spouse) — checking Kid makes all 3 → collapse
    renderCard(
      makeSection({ attendee_categories: ["main", "spouse"] }),
      onUpdate,
    )

    await user.click(screen.getByLabelText("Kid"))

    expect(onUpdate).toHaveBeenCalledWith("test-section", {
      attendee_categories: null,
    })
  })

  it("unchecking the only checked box calls onUpdate with attendee_categories: null (empty collapse)", async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    renderCard(makeSection({ attendee_categories: ["main"] }), onUpdate)

    await user.click(screen.getByLabelText("Main"))

    expect(onUpdate).toHaveBeenCalledWith("test-section", {
      attendee_categories: null,
    })
  })

  it("existing ['main','spouse'] renders Main+Spouse checked, Kid unchecked, no hint", () => {
    renderCard(makeSection({ attendee_categories: ["main", "spouse"] }))

    expect(screen.getByLabelText("Main")).toHaveAttribute(
      "data-state",
      "checked",
    )
    expect(screen.getByLabelText("Spouse")).toHaveAttribute(
      "data-state",
      "checked",
    )
    expect(screen.getByLabelText("Kid")).toHaveAttribute(
      "data-state",
      "unchecked",
    )
    expect(
      screen.queryByText("Visible to all attendees"),
    ).not.toBeInTheDocument()
  })
})
