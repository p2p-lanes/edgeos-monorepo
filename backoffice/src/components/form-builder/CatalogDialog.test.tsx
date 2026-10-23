import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  FormFieldsService: {
    listAvailableBaseFields: vi.fn(),
    createBaseFieldConfig: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { FormFieldsService } from "@/client"
import { CatalogDialog } from "./CatalogDialog"

const listAvailable = vi.mocked(FormFieldsService.listAvailableBaseFields)
const createBase = vi.mocked(FormFieldsService.createBaseFieldConfig)

describe("CatalogDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAvailable.mockResolvedValue([
      {
        field_name: "residence",
        type: "text",
        label: "Usual location of residence",
        required: true,
        target: "human",
        default_section_key: "profile",
      },
    ])
    createBase.mockResolvedValue({} as never)
  })

  it("loads and adds fields for the active flow", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <CatalogDialog
          popupId="popup-1"
          salesFlowId="flow-2"
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(listAvailable).toHaveBeenCalledWith({
      popupId: "popup-1",
      salesFlowId: "flow-2",
    })
    await userEvent.click(
      await screen.findByRole("button", {
        name: /usual location of residence/i,
      }),
    )
    await waitFor(() =>
      expect(createBase).toHaveBeenCalledWith({
        popupId: "popup-1",
        salesFlowId: "flow-2",
        fieldName: "residence",
      }),
    )
  })
})
