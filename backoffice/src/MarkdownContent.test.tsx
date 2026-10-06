import { MarkdownContent, markdownContentClass } from "@edgeos/shared-form-ui"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

describe("MarkdownContent paragraph spacing", () => {
  it("separates paragraphs by one line height using the shared editor style", () => {
    const { container } = render(
      <MarkdownContent source={"First paragraph.\n\nSecond paragraph."} />,
    )

    expect(container.querySelectorAll("p")).toHaveLength(2)
    expect(container.firstElementChild).toHaveClass("leading-5", "[&_p+p]:mt-5")
    expect(container.firstElementChild?.className).toBe(markdownContentClass)
    expect(container.firstElementChild).not.toHaveClass("[&_p+p]:mt-2")
  })

  it("keeps single newlines as line breaks within a paragraph", () => {
    const { container } = render(
      <MarkdownContent source={"First line.\nSecond line."} />,
    )

    expect(container.querySelectorAll("p")).toHaveLength(1)
    expect(container.querySelectorAll("p br")).toHaveLength(1)
  })

  it("uses uniform paragraph spacing even with extra blank lines", () => {
    const { container } = render(
      <MarkdownContent source={"First paragraph.\n\n\n\nSecond paragraph."} />,
    )

    expect(container.querySelectorAll("p")).toHaveLength(2)
    expect(container.querySelectorAll("br")).toHaveLength(0)
    expect(container.firstElementChild).toHaveClass("[&_p+p]:mt-5")
  })
})
