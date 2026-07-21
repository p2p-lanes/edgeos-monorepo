import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SectionEditor } from "./SectionEditor"
import type { ProductSection } from "./sectionTypes"

// ImageUpload is irrelevant for these tests
vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: () => null,
}))

const DEFAULT_CATEGORIES = [
  { id: "cat-main", key: "main", label: "Main" },
  { id: "cat-spouse", key: "spouse", label: "Spouse" },
  { id: "cat-kid", key: "kid", label: "Kid" },
]

function makeSection(overrides: Partial<ProductSection> = {}): ProductSection {
  return {
    key: "test-section",
    label: "Test Section",
    order: 0,
    product_ids: [],
    ...overrides,
  }
}

async function renderEditor(section: ProductSection, onUpdate = vi.fn()) {
  const result = render(
    <SectionEditor
      section={section}
      onUpdate={onUpdate}
      products={[]}
      showAttendeeCategories={true}
      showMediaFields={false}
      attendeeCategories={DEFAULT_CATEGORIES}
    />,
  )
  // The attendee-category checkboxes now live inside the collapsed
  // "Targeting & visibility" group — expand it before querying.
  const user = userEvent.setup()
  await user.click(screen.getByText("Targeting & visibility"))
  return result
}

describe("SectionEditor — attendee category checkboxes", () => {
  it("renders checkboxes for each category", async () => {
    await renderEditor(makeSection())
    expect(screen.getByLabelText("Main")).toBeInTheDocument()
    expect(screen.getByLabelText("Spouse")).toBeInTheDocument()
    expect(screen.getByLabelText("Kid")).toBeInTheDocument()
  })

  it("null attendee_categories: all checkboxes unchecked and 'Visible to all attendees' hint shown", async () => {
    await renderEditor(makeSection({ attendee_categories: null }))

    const mainCb = screen.getByLabelText("Main")
    const spouseCb = screen.getByLabelText("Spouse")
    const kidCb = screen.getByLabelText("Kid")

    // Radix Checkbox reflects checked state via data-state attribute
    expect(mainCb).toHaveAttribute("data-state", "unchecked")
    expect(spouseCb).toHaveAttribute("data-state", "unchecked")
    expect(kidCb).toHaveAttribute("data-state", "unchecked")

    expect(screen.getByText("Visible to all attendees")).toBeInTheDocument()
  })

  it("clicking Main alone calls onUpdate with attendee_categories containing its UUID", async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    await renderEditor(makeSection({ attendee_categories: null }), onUpdate)

    await user.click(screen.getByLabelText("Main"))

    expect(onUpdate).toHaveBeenCalledWith("test-section", {
      attendee_categories: ["cat-main"],
    })
  })

  it("checking all categories calls onUpdate with attendee_categories: null (collapse rule)", async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    // Start with 2 checked (main, spouse) — checking Kid makes all → collapse
    await renderEditor(
      makeSection({ attendee_categories: ["cat-main", "cat-spouse"] }),
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
    await renderEditor(
      makeSection({ attendee_categories: ["cat-main"] }),
      onUpdate,
    )

    await user.click(screen.getByLabelText("Main"))

    expect(onUpdate).toHaveBeenCalledWith("test-section", {
      attendee_categories: null,
    })
  })

  it("existing ['cat-main','cat-spouse'] renders Main+Spouse checked, Kid unchecked, no hint", async () => {
    await renderEditor(
      makeSection({ attendee_categories: ["cat-main", "cat-spouse"] }),
    )

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
