import { createHash } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BackendExecutionStore } from "./execution-store.js"

const context = {
  authorization: "Bearer user-jwt",
  tenantId: "tenant-1",
  popup: { id: "popup-1", tenant_id: "tenant-1", name: "Gathering" },
  user: { id: "user-1", email: "admin@example.com", role: "admin" as const },
}

afterEach(() => vi.unstubAllGlobals())

describe("BackendExecutionStore", () => {
  it("claims and completes a write through the authenticated backend store", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "acquired", result: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const store = new BackendExecutionStore("http://backend:8000")

    await expect(
      store.claim(context, "tool/call", "a".repeat(64)),
    ).resolves.toEqual({ state: "acquired" })
    await store.complete(context, "tool/call", "a".repeat(64), { status: 201 })

    const executionId = createHash("sha256").update("tool/call").digest("hex")
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://backend:8000/api/v1/ai-executions/${executionId}/claim`,
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `http://backend:8000/api/v1/ai-executions/${executionId}/complete`,
    )
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer user-jwt",
      "X-Tenant-Id": "tenant-1",
    })
  })

  it("returns a completed durable result without requesting another write", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ state: "completed", result: { status: 201 } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    )
    const store = new BackendExecutionStore("http://backend:8000")

    await expect(
      store.claim(context, "tool-call", "b".repeat(64)),
    ).resolves.toEqual({ state: "completed", result: { status: 201 } })
  })
})
