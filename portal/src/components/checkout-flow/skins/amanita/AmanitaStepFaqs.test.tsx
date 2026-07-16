/**
 * Tests for AmanitaStepFaqs — a step's own FAQs, rendered below its content on
 * the Amanita skin. `template_config` is unvalidated JSON from the backend, so
 * most of these cover the parser refusing to render junk.
 *
 * No jest-dom in this project — assertions use `getByRole`/`getByText`/
 * `fireEvent`/`toBeTruthy()`, same as FaqsDrawer.test.tsx.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import AmanitaStepFaqs, { parseStepFaqs } from "./AmanitaStepFaqs"

const FAQS = {
  title: "Preguntas sobre el acampe",
  items: [
    {
      id: "a",
      question: "¿Puedo hacer fuego?",
      answer: "No, está prohibido en todo el predio.",
    },
    {
      id: "b",
      question: "¿Hay electricidad?",
      answer: "No hay electricidad en la zona de acampe.",
    },
  ],
}

describe("parseStepFaqs", () => {
  it("returns null when there is no config at all", () => {
    expect(parseStepFaqs(null)).toBeNull()
    expect(parseStepFaqs(undefined)).toBeNull()
    expect(parseStepFaqs({})).toBeNull()
  })

  it("returns null when faqs is not an object or items is not an array", () => {
    expect(parseStepFaqs({ faqs: "nope" })).toBeNull()
    expect(parseStepFaqs({ faqs: { items: "nope" } })).toBeNull()
    expect(parseStepFaqs({ faqs: { items: [] } })).toBeNull()
  })

  it("drops items with no question, and returns null if none survive", () => {
    expect(
      parseStepFaqs({ faqs: { items: [{ answer: "huérfana" }, {}] } }),
    ).toBeNull()

    const parsed = parseStepFaqs({
      faqs: {
        items: [{ question: "  " }, { question: "Real?", answer: "Sí" }],
      },
    })
    expect(parsed?.items).toEqual([{ question: "Real?", answer: "Sí" }])
  })

  it("coalesces a missing answer rather than rendering undefined", () => {
    const parsed = parseStepFaqs({ faqs: { items: [{ question: "Q" }] } })
    expect(parsed?.items).toEqual([{ question: "Q", answer: "" }])
  })

  it("treats a blank title as no title", () => {
    const parsed = parseStepFaqs({
      faqs: { title: "   ", items: [{ question: "Q", answer: "A" }] },
    })
    expect(parsed?.title).toBeUndefined()
  })
})

describe("AmanitaStepFaqs", () => {
  it("renders nothing when the step has no FAQs", () => {
    const { container } = render(<AmanitaStepFaqs templateConfig={null} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders the title and one row per question", () => {
    render(<AmanitaStepFaqs templateConfig={{ faqs: FAQS }} />)

    expect(screen.getByText("Preguntas sobre el acampe")).toBeTruthy()
    // The mockup's accordion opens the first question by default.
    expect(
      screen
        .getByRole("button", { name: /Puedo hacer fuego/ })
        .getAttribute("aria-expanded"),
    ).toBe("true")
    expect(
      screen
        .getByRole("button", { name: /Hay electricidad/ })
        .getAttribute("aria-expanded"),
    ).toBe("false")
    expect(
      screen.queryByText("No hay electricidad en la zona de acampe."),
    ).toBeNull()
  })

  it("expands a question on click", () => {
    render(<AmanitaStepFaqs templateConfig={{ faqs: FAQS }} />)

    fireEvent.click(screen.getByRole("button", { name: /Hay electricidad/ }))

    expect(
      screen.getByText("No hay electricidad en la zona de acampe."),
    ).toBeTruthy()
  })

  it("renders the questions with no heading when no title is authored", () => {
    render(<AmanitaStepFaqs templateConfig={{ faqs: { items: FAQS.items } }} />)

    expect(screen.queryByText("Preguntas sobre el acampe")).toBeNull()
    expect(
      screen.getByRole("button", { name: /Puedo hacer fuego/ }),
    ).toBeTruthy()
  })
})
