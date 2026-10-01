import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  ApplicationFilterBuilder,
  type FilterCondition,
  sanitizeFilterConditions,
} from "./ApplicationFilterBuilder"

describe("application reviewer filters", () => {
  it.each([
    ["Strong yes", "strong_yes"],
    ["Yes", "yes"],
    ["No", "no"],
    ["Strong no", "strong_no"],
  ])("combines Reviewed by with Review vote: %s", async (label, vote) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const sophieId = "9627c145-7e11-48af-9d4f-5d5b517cf785"
    function Filters() {
      const [conditions, setConditions] = useState<FilterCondition[]>([])
      return (
        <ApplicationFilterBuilder
          statusOptions={[{ value: "accepted", label: "Accepted" }]}
          customFields={[]}
          reviewerOptions={[{ value: sophieId, label: "Sophie" }]}
          match="all"
          conditions={conditions}
          onChange={(match, next) => {
            setConditions(next)
            onChange(match, next)
          }}
        />
      )
    }
    render(<Filters />)
    await user.click(screen.getByRole("button", { name: "Filter" }))
    await user.click(screen.getByRole("button", { name: "Add filter" }))
    await user.click(screen.getAllByRole("combobox")[1])
    expect(
      screen.queryByRole("option", { name: "Strong yes by" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: "Strong no by" }),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("option", { name: "Review vote", exact: true }),
    )
    await user.click(screen.getAllByRole("combobox")[3])
    await user.click(screen.getByRole("option", { name: label, exact: true }))
    expect(onChange).toHaveBeenLastCalledWith("all", [
      { field: "review_decision", op: "eq", value: vote },
    ])

    await user.click(screen.getByRole("button", { name: "Add filter" }))
    await user.click(screen.getAllByRole("combobox")[4])
    await user.click(
      screen.getByRole("option", { name: "Reviewed by", exact: true }),
    )
    await user.click(screen.getAllByRole("combobox")[6])
    await user.click(screen.getByRole("option", { name: "Sophie" }))
    const expected = [
      { field: "review_decision", op: "eq", value: vote },
      { field: "reviewed_by", op: "eq", value: sophieId },
    ]
    expect(onChange).toHaveBeenLastCalledWith("all", expected)
    expect(
      sanitizeFilterConditions(JSON.parse(JSON.stringify(expected))),
    ).toEqual(expected)
  })
})
