import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { HostDisplayField } from "./HostDisplayField"

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isFetching: false }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      if (key === "events.form.host_placeholder_popup") return values?.name
      if (key === "events.form.host_placeholder_optional") return "Optional"
      return key
    },
  }),
}))

describe("HostDisplayField", () => {
  it("uses the popup name without retired sales-flow terminology", () => {
    render(
      <HostDisplayField value="" onChange={vi.fn()} popupName="Tech Summit" />,
    )

    expect(
      screen
        .getByLabelText("events.form.host_label")
        .getAttribute("placeholder"),
    ).toBe("Tech Summit")
  })

  it("uses the optional placeholder when no popup name is available", () => {
    render(<HostDisplayField value="" onChange={vi.fn()} />)

    expect(
      screen
        .getByLabelText("events.form.host_label")
        .getAttribute("placeholder"),
    ).toBe("Optional")
  })
})
