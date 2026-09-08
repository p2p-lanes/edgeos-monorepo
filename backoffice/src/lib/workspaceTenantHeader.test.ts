import axios from "axios"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OpenAPI, SalesFlowsService } from "@/client"
import { withWorkspaceTenant } from "./workspaceTenantHeader"

describe("workspace tenant header", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it("adds ambient context only when the request did not capture a tenant", () => {
    expect(withWorkspaceTenant({}, "tenant-b").headers).toEqual({
      "X-Tenant-Id": "tenant-b",
    })
    expect(
      withWorkspaceTenant(
        { headers: { "X-Tenant-Id": "tenant-a" } },
        "tenant-b",
      ).headers,
    ).toEqual({ "X-Tenant-Id": "tenant-a" })
  })
  it("keeps the captured header when tenant changes during generated async auth resolution", async () => {
    const originalToken = OpenAPI.TOKEN
    let resolveToken!: (token: string) => void
    OpenAPI.TOKEN = () =>
      new Promise<string>((resolve) => {
        resolveToken = resolve
      })
    let ambientTenant = "tenant-a"
    const interceptor = (config: Parameters<typeof withWorkspaceTenant>[0]) =>
      withWorkspaceTenant(config, ambientTenant)
    OpenAPI.interceptors.request.use(interceptor)
    const transport = vi.spyOn(axios, "request").mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      data: { results: [] },
    })
    try {
      const pending = SalesFlowsService.listSalesFlows({
        popupId: "popup-a",
        limit: 100,
        xTenantId: "tenant-a",
      })
      ambientTenant = "tenant-b"
      resolveToken("test-token")
      await pending
      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ "X-Tenant-Id": "tenant-a" }),
        }),
      )
    } finally {
      OpenAPI.TOKEN = originalToken
      OpenAPI.interceptors.request.eject(interceptor)
    }
  })
})
