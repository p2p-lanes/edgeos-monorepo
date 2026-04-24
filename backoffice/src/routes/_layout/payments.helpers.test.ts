import { describe, expect, it } from "vitest"

import {
  buildPaymentsQueryConfig,
  buildPaymentsTableState,
} from "./payments.helpers"

describe("payments.helpers", () => {
  it("forwards the server search term in query params and cache key", () => {
    const config = buildPaymentsQueryConfig({
      popupId: "popup-123",
      page: 2,
      pageSize: 25,
      search: "Lucia",
    })

    expect(config.params).toEqual({
      skip: 50,
      limit: 25,
      popupId: "popup-123",
      search: "Lucia",
    })
    expect(config.queryKey).toEqual([
      "payments",
      "popup-123",
      { page: 2, pageSize: 25, search: "Lucia" },
    ])
  })

  it("uses server totals and preserves server rows without local filtering", () => {
    const state = buildPaymentsTableState({
      payments: {
        results: [{ id: "payment-1" }, { id: "payment-2" }],
        paging: { total: 60 },
      },
      pagination: { pageIndex: 1, pageSize: 25 },
    })

    expect(state.data).toEqual([{ id: "payment-1" }, { id: "payment-2" }])
    expect(state.serverPagination).toEqual({
      total: 60,
      pagination: { pageIndex: 1, pageSize: 25 },
    })
  })
})
