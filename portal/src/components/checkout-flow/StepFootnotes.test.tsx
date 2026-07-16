/**
 * Tests for StepFootnotes — the stepper's renderer for a step's "Footer Note".
 * The stepper never drew it before, so an authored note was invisible.
 *
 * No jest-dom in this project — assertions use `getByText`/`toBeTruthy()`.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import StepFootnotes, { parseFootnotes } from "./StepFootnotes"

const NOTE = {
  footer_text:
    "No hay reembolsos, sin excepción.\nEntradas transferibles hasta el 30 de octubre de 2026.",
}

describe("parseFootnotes", () => {
  it("returns nothing when there is no note", () => {
    expect(parseFootnotes(null)).toEqual([])
    expect(parseFootnotes(undefined)).toEqual([])
    expect(parseFootnotes({})).toEqual([])
    expect(parseFootnotes({ footer_text: "" })).toEqual([])
    expect(parseFootnotes({ footer_text: "   \n  " })).toEqual([])
  })

  it("ignores a footer_text that isn't a string", () => {
    expect(parseFootnotes({ footer_text: 42 })).toEqual([])
  })

  it("splits on newlines, dropping blank lines", () => {
    expect(parseFootnotes({ footer_text: "uno\n\n dos \n" })).toEqual([
      "uno",
      "dos",
    ])
  })

  it("strips a leading bullet the organizer typed themselves", () => {
    // Amanita prints its own "*"; without this the line reads "* * No hay...".
    expect(
      parseFootnotes({ footer_text: "* No hay reembolsos\n• Otra\n- Tercera" }),
    ).toEqual(["No hay reembolsos", "Otra", "Tercera"])
  })

  it("keeps an asterisk that isn't the line's bullet", () => {
    expect(parseFootnotes({ footer_text: "Ver 2*3 detalles" })).toEqual([
      "Ver 2*3 detalles",
    ])
  })
})

describe("StepFootnotes", () => {
  it("renders nothing when the step has no note", () => {
    const { container } = render(
      <StepFootnotes skin="amanita" templateConfig={null} />,
    )
    expect(container.innerHTML).toBe("")
  })

  it("renders one asterisked line per note on amanita", () => {
    render(<StepFootnotes skin="amanita" templateConfig={NOTE} />)

    expect(screen.getByText("* No hay reembolsos, sin excepción.")).toBeTruthy()
    expect(
      screen.getByText(
        "* Entradas transferibles hasta el 30 de octubre de 2026.",
      ),
    ).toBeTruthy()
  })

  it("renders the note without asterisks on the default skin", () => {
    render(<StepFootnotes skin="default" templateConfig={NOTE} />)

    expect(screen.getByText("No hay reembolsos, sin excepción.")).toBeTruthy()
    expect(screen.queryByText(/^\* /)).toBeNull()
  })
})
