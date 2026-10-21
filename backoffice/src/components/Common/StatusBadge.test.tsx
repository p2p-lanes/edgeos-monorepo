import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StatusBadge } from "./StatusBadge"

describe("StatusBadge", () => {
  it.each(["withdrawn", "WITHDRAWN"])("renders %s visibly", (status) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText("Withdrawn")).toBeVisible()
  })
})
