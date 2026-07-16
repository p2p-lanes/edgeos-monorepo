/**
 * Covers the config shape FaqsConfig writes, which its editor UI now shares
 * with the per-step "FAQs" card via FaqItemsEditor. The portal reads these
 * keys positionally out of untyped JSON, so a silent rename here would break
 * the checkout with nothing to catch it.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FaqsConfig } from "./FaqsConfig"
import { TEMPLATE_CONFIG_REGISTRY } from "./index"

describe("FaqsConfig", () => {
  function renderConfig(config: Record<string, unknown> | null = null) {
    const onChange = vi.fn()
    render(
      <FaqsConfig
        config={config}
        onChange={onChange}
        popupId="popup-1"
        productCategory={null}
      />,
    )
    return onChange
  }

  const items = [{ id: "a", question: "¿Puedo hacer fuego?", answer: "No." }]

  it("is wired into the config registry", () => {
    expect(TEMPLATE_CONFIG_REGISTRY.faqs).toBe(FaqsConfig)
  })

  it("renders authored questions and the section title", () => {
    renderConfig({ title: "Preguntas sobre el acampe", items })

    expect(screen.getByDisplayValue("Preguntas sobre el acampe")).toBeTruthy()
    expect(screen.getByDisplayValue("¿Puedo hacer fuego?")).toBeTruthy()
    expect(screen.getByText("Questions (1)")).toBeTruthy()
  })

  it("appends a question with a stable id, preserving the rest of the config", () => {
    const onChange = renderConfig({ variant: "cards", items })

    fireEvent.click(screen.getByRole("button", { name: /Add Question/ }))

    const next = onChange.mock.calls[0][0]
    expect(next.variant).toBe("cards")
    expect(next.items).toHaveLength(2)
    expect(next.items[0]).toEqual(items[0])
    expect(next.items[1]).toMatchObject({ question: "", answer: "" })
    expect(next.items[1].id).toBeTruthy()
  })

  it("saves a blank title as undefined rather than an empty string", () => {
    const onChange = renderConfig({ title: "Algo", items })

    fireEvent.change(screen.getByDisplayValue("Algo"), {
      target: { value: "" },
    })

    expect(onChange.mock.calls[0][0].title).toBeUndefined()
  })

  it("keeps the accordion layout implicit and names the others", () => {
    const onChange = renderConfig({ items })

    fireEvent.click(screen.getByRole("button", { name: /Two Column/ }))
    expect(onChange.mock.calls[0][0].variant).toBe("two-column")

    fireEvent.click(screen.getByRole("button", { name: /Accordion/ }))
    expect(onChange.mock.calls[1][0].variant).toBeUndefined()
  })

  it("survives a config whose items are missing or malformed", () => {
    expect(() => renderConfig(null)).not.toThrow()
    expect(screen.getByText("Questions (0)")).toBeTruthy()
  })
})
