/**
 * FaqItemsEditor is shared by the `faqs` template's editor and the per-step
 * "FAQs" card, so these cover the editing behaviour both inherit — in
 * particular that typing in the title field survives, which a naive
 * "drop the config when there are no questions" owner breaks.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  buildFaqsValue,
  type FaqItem,
  FaqItemsEditor,
  parseFaqItems,
} from "./FaqItemsEditor"

describe("parseFaqItems", () => {
  it("returns an empty list for anything that isn't an array", () => {
    expect(parseFaqItems(undefined)).toEqual([])
    expect(parseFaqItems(null)).toEqual([])
    expect(parseFaqItems("nope")).toEqual([])
    expect(parseFaqItems({ 0: "nope" })).toEqual([])
  })
})

describe("buildFaqsValue", () => {
  const items: FaqItem[] = [{ id: "a", question: "Q", answer: "A" }]

  it("drops the block entirely once it holds nothing", () => {
    expect(buildFaqsValue("", [])).toBeUndefined()
    expect(buildFaqsValue("   ", [])).toBeUndefined()
  })

  it("keeps a title typed before the first question exists", () => {
    // Otherwise the field erases itself as the organizer types into it.
    expect(buildFaqsValue("P", [])).toEqual({ title: "P", items: [] })
  })

  it("stores the title untrimmed so a space can be typed mid-title", () => {
    expect(buildFaqsValue("Preguntas ", items)?.title).toBe("Preguntas ")
  })

  it("omits an empty title rather than storing a blank string", () => {
    expect(buildFaqsValue("", items)).toEqual({ title: undefined, items })
  })
})

describe("FaqItemsEditor", () => {
  const items: FaqItem[] = [
    { id: "a", question: "¿Puedo hacer fuego?", answer: "No." },
  ]

  function renderEditor(props: Partial<{ title: string; items: FaqItem[] }>) {
    const onChangeTitle = vi.fn()
    const onChangeItems = vi.fn()
    render(
      <FaqItemsEditor
        title={props.title ?? ""}
        items={props.items ?? []}
        onChangeTitle={onChangeTitle}
        onChangeItems={onChangeItems}
      />,
    )
    return { onChangeTitle, onChangeItems }
  }

  it("reports the title verbatim, including a trailing space", () => {
    // The owner trims only to decide emptiness — trimming the stored value on
    // each keystroke would make a multi-word title untypeable.
    const { onChangeTitle } = renderEditor({ title: "Preguntas" })

    fireEvent.change(screen.getByDisplayValue("Preguntas"), {
      target: { value: "Preguntas " },
    })

    expect(onChangeTitle).toHaveBeenCalledWith("Preguntas ")
  })

  it("shows the empty state until a question is added", () => {
    const { onChangeItems } = renderEditor({})

    expect(screen.getByText(/No questions added yet/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Add Question/ }))

    expect(onChangeItems.mock.calls[0][0]).toHaveLength(1)
  })

  it("edits a question and an answer in place", () => {
    const { onChangeItems } = renderEditor({ items })

    fireEvent.change(screen.getByDisplayValue("¿Puedo hacer fuego?"), {
      target: { value: "¿Hay electricidad?" },
    })
    expect(onChangeItems.mock.calls[0][0]).toEqual([
      { id: "a", question: "¿Hay electricidad?", answer: "No." },
    ])

    fireEvent.change(screen.getByDisplayValue("No."), {
      target: { value: "No hay." },
    })
    expect(onChangeItems.mock.calls[1][0]).toEqual([
      { id: "a", question: "¿Puedo hacer fuego?", answer: "No hay." },
    ])
  })

  it("removes a question", () => {
    const { onChangeItems } = renderEditor({
      items: [...items, { id: "b", question: "Otra", answer: "" }],
    })

    // One trash button per row; the second row's is the last button rendered.
    const buttons = screen.getAllByRole("button")
    fireEvent.click(buttons[buttons.length - 1])

    expect(onChangeItems.mock.calls[0][0]).toEqual(items)
  })
})
