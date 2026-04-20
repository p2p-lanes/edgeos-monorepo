import { SchemaField } from "@edgeos/shared-form-ui"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

describe("SchemaField — date field with date range bounds", () => {
  it("renders date input with min and max attributes when both bounds are set", () => {
    render(
      <SchemaField
        name="event_date"
        field={{
          type: "date",
          label: "Event Date",
          required: false,
          min_date: "2025-06-01",
          max_date: "2025-08-31",
        }}
        value=""
        onChange={vi.fn()}
      />,
    )

    // date inputs don't have role="textbox"; query directly by type
    const dateInput = document.querySelector(
      "input[type='date']",
    ) as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(dateInput.getAttribute("min")).toBe("2025-06-01")
    expect(dateInput.getAttribute("max")).toBe("2025-08-31")
  })

  it("renders date input without min attribute when min_date is null", () => {
    render(
      <SchemaField
        name="event_date_no_min"
        field={{
          type: "date",
          label: "Event Date",
          required: false,
          min_date: null,
          max_date: "2025-12-31",
        }}
        value=""
        onChange={vi.fn()}
      />,
    )

    const dateInput = document.querySelector(
      "input[type='date']",
    ) as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(dateInput.getAttribute("min")).toBeNull()
    expect(dateInput.getAttribute("max")).toBe("2025-12-31")
  })

  it("renders date input without max attribute when max_date is null", () => {
    render(
      <SchemaField
        name="event_date_no_max"
        field={{
          type: "date",
          label: "Event Date",
          required: false,
          min_date: "2025-01-01",
          max_date: null,
        }}
        value=""
        onChange={vi.fn()}
      />,
    )

    const dateInput = document.querySelector(
      "input[type='date']",
    ) as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(dateInput.getAttribute("min")).toBe("2025-01-01")
    expect(dateInput.getAttribute("max")).toBeNull()
  })

  it("renders date input without min/max when both bounds are null", () => {
    render(
      <SchemaField
        name="event_date_no_bounds"
        field={{
          type: "date",
          label: "Event Date",
          required: false,
          min_date: null,
          max_date: null,
        }}
        value=""
        onChange={vi.fn()}
      />,
    )

    const dateInput = document.querySelector(
      "input[type='date']",
    ) as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(dateInput.getAttribute("min")).toBeNull()
    expect(dateInput.getAttribute("max")).toBeNull()
  })

  it("renders date input without min/max when bounds are undefined (no bounds set)", () => {
    render(
      <SchemaField
        name="event_date_undefined_bounds"
        field={{
          type: "date",
          label: "Event Date",
          required: false,
        }}
        value=""
        onChange={vi.fn()}
      />,
    )

    const dateInput = document.querySelector(
      "input[type='date']",
    ) as HTMLInputElement
    expect(dateInput).not.toBeNull()
    expect(dateInput.getAttribute("min")).toBeNull()
    expect(dateInput.getAttribute("max")).toBeNull()
  })
})
