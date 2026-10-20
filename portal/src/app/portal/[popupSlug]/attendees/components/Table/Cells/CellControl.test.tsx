import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CellControl from "./CellControl"

describe("CellControl", () => {
  it("shows the hidden indicator for a masked field", () => {
    const { container, queryByText } = render(
      <CellControl value="*">someone@example.test</CellControl>,
    )

    expect(container.querySelector("svg")).not.toBeNull()
    expect(queryByText("someone@example.test")).toBeNull()
  })

  it("renders a shared field value normally", () => {
    const { container, getByText } = render(
      <CellControl value="someone@example.test">
        someone@example.test
      </CellControl>,
    )

    expect(container.querySelector("svg")).toBeNull()
    expect(getByText("someone@example.test")).toBeTruthy()
  })
})
