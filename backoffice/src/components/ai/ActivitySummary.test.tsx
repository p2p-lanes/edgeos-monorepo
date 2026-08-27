import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vitest"
import { isBackgroundToolPart } from "./ActivitySummary"
import { MessageParts } from "./ToolPartRenderer"
import type { GenericToolPart } from "./tool-types"

describe("AI activity summary", () => {
  it("keeps operation catalogs and raw read results out of the transcript", async () => {
    const user = userEvent.setup()
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-searchOperations",
          toolCallId: "search-1",
          state: "output-available",
          output: {
            operations: [
              {
                operationId: "applications-list_applications",
                method: "GET",
                summary: "List Applications",
              },
            ],
          },
        },
        {
          type: "tool-executeOperation",
          toolCallId: "read-1",
          state: "output-available",
          output: {
            operation: {
              operationId: "applications-list_applications",
              method: "GET",
              summary: "List Applications",
            },
            status: 200,
            data: { private_record: "must not appear" },
          },
        },
        { type: "text", text: "There are two applications to review." },
      ],
    } as unknown as UIMessage

    render(
      <MessageParts
        message={message}
        onApproval={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(
      screen.getByText("There are two applications to review."),
    ).toBeInTheDocument()
    expect(screen.getByText("Activity")).toBeInTheDocument()
    expect(screen.queryByText("must not appear")).not.toBeInTheDocument()
    expect(
      screen.queryByText("applications-list_applications"),
    ).not.toBeInTheDocument()

    await user.click(screen.getByText("Activity"))
    expect(screen.getByText("Checked available actions")).toBeVisible()
    expect(screen.getByText("List Applications")).toBeVisible()
    expect(screen.getByText("GET · 200")).toBeVisible()
  })

  it("renders restored prepared files as expired cards", () => {
    const message = {
      id: "assistant-expired",
      role: "assistant",
      parts: [
        {
          type: "data-expired-prepared-file",
          data: { persistedState: "expired", kind: "download" },
        },
      ],
    } as unknown as UIMessage

    render(
      <MessageParts
        message={message}
        onApproval={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByText("Prepared file expired")).toBeInTheDocument()
    expect(screen.queryByText("Activity")).not.toBeInTheDocument()
  })

  it("keeps approvals and write results in the main transcript", () => {
    const approval = {
      type: "tool-executeOperation",
      state: "approval-requested",
      approval: { id: "approval-1" },
    } satisfies GenericToolPart
    const writeResult = {
      type: "tool-executeOperation",
      state: "output-available",
      output: {
        operation: { method: "POST", summary: "Submit Review" },
        status: 201,
      },
    } satisfies GenericToolPart

    expect(isBackgroundToolPart(approval)).toBe(false)
    expect(isBackgroundToolPart(writeResult)).toBe(false)
    expect(
      isBackgroundToolPart({
        type: "tool-prepareCustomExport",
        state: "output-available",
      }),
    ).toBe(false)
  })
})
