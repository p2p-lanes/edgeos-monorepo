import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryExecutionStore } from "./execution-store.js"
import { EdgeOSOperationCatalog } from "./operation-catalog.js"

const context = {
  authorization: "Bearer user-jwt",
  tenantId: "tenant-1",
  popup: { id: "popup-1", tenant_id: "tenant-1", name: "Gathering" },
  user: { id: "user-1", email: "admin@example.com", role: "admin" as const },
}

function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "request-1",
    },
  })
}

const openapi = {
  components: {
    schemas: {
      TicketAdd: {
        type: "object",
        required: ["popup_id", "items"],
        properties: {
          popup_id: { type: "string", format: "uuid" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_id: { type: "string", format: "uuid" },
                quantity: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
      ApplicationReviewCreate: {
        type: "object",
        required: ["decision"],
        properties: {
          decision: {
            type: "string",
            enum: ["strong_yes", "yes", "no", "strong_no"],
          },
          notes: { type: ["string", "null"] },
        },
      },
    },
  },
  paths: {
    "/api/v1/attendees": {
      get: {
        operationId: "list_attendees",
        summary: "List attendees",
        tags: ["attendees"],
        parameters: [
          {
            name: "popup_id",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/attendees/{attendee_id}": {
      get: {
        operationId: "get_attendee",
        summary: "Get attendee",
        tags: ["attendees"],
        parameters: [
          {
            name: "attendee_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/products/{product_id}": {
      get: {
        operationId: "get_product",
        summary: "Get product",
        tags: ["products"],
        parameters: [
          {
            name: "product_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/attendees/{attendee_id}/tickets": {
      post: {
        operationId: "add_attendee_ticket",
        summary: "Add a ticket to an attendee",
        description:
          "Admin grant with no payment. Stock is decremented and a check-in code is created.",
        tags: ["attendees"],
        parameters: [
          {
            name: "attendee_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TicketAdd" },
            },
          },
        },
        responses: { "201": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/applications/{application_id}": {
      get: {
        operationId: "get_application",
        summary: "Get application",
        tags: ["applications"],
        parameters: [
          {
            name: "application_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/applications/{application_id}/reviews": {
      post: {
        operationId: "submit_review",
        summary: "Submit Review",
        description:
          "Submit a review. The application status is recalculated using the gathering approval strategy.",
        tags: ["application-reviews"],
        parameters: [
          {
            name: "application_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ApplicationReviewCreate",
              },
            },
          },
        },
        responses: { "201": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/popups/{popup_id}": {
      patch: {
        operationId: "popups-update_popup",
        summary: "Update Popup",
        tags: ["popups"],
        parameters: [
          {
            name: "popup_id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: ["string", "null"] },
                  start_date: { type: ["string", "null"], format: "date-time" },
                  end_date: { type: ["string", "null"], format: "date-time" },
                },
              },
            },
          },
        },
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
    "/api/v1/exports/{popup_id}/attendees.csv": {
      get: {
        operationId: "export_attendees_csv",
        summary: "Export attendees CSV",
        tags: ["attendees"],
        parameters: [
          {
            name: "popup_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { content: { "text/csv": {} } } },
      },
    },
    "/api/v1/auth/login": {
      post: {
        operationId: "login",
        tags: ["auth"],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { content: { "application/json": {} } } },
      },
    },
  },
}

describe("EdgeOSOperationCatalog", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("discovers reads and writes with resolved JSON body schemas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(openapi)))
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    const operations = await catalog.search("assign product attendee")
    expect(operations).toContainEqual(
      expect.objectContaining({
        operationId: "add_attendee_ticket",
        method: "POST",
        approval: "required",
        arguments: expect.objectContaining({
          body: expect.objectContaining({
            fields: expect.arrayContaining(["popup_id", "product_id"]),
          }),
        }),
      }),
    )
    await expect(
      catalog.describe("add_attendee_ticket"),
    ).resolves.toMatchObject({
      arguments: {
        body: {
          schema: {
            properties: {
              popup_id: { type: "string", format: "uuid" },
            },
          },
        },
      },
    })
    await expect(catalog.get("login")).rejects.toMatchObject({ status: 404 })
  })

  it("prepares and streams declared file downloads without putting bytes in tool output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(
        new Response("name,email\nAda,ada@example.com\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="attendees.csv"',
          },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.search("descargar el archivo CSV de asistentes", 5, "read"),
    ).resolves.toContainEqual(
      expect.objectContaining({ operationId: "export_attendees_csv" }),
    )
    await expect(
      catalog.describe("export_attendees_csv"),
    ).resolves.toMatchObject({
      result: {
        kind: "download",
        mediaTypes: ["text/csv"],
        filename: "attendees.csv",
      },
    })
    await expect(
      catalog.execute("export_attendees_csv", context, {}),
    ).resolves.toMatchObject({
      status: 200,
      data: null,
      download: {
        endpoint: "/api/ai/downloads",
        filename: "attendees.csv",
        mediaTypes: ["text/csv"],
        arguments: { path: { popup_id: "popup-1" }, query: {} },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const file = await catalog.download("export_attendees_csv", context, {
      path: { popup_id: "popup-1" },
      query: {},
    })
    expect(await file.text()).toContain("Ada,ada@example.com")
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://backend:8000/api/v1/exports/popup-1/attendees.csv",
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Accept: "text/csv" }),
    })
  })

  it("finds the gathering date update from natural festival language", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(openapi)))
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    const operations = await catalog.search(
      "update dates for this festival",
      8,
      "write",
    )

    expect(operations[0]).toMatchObject({
      operationId: "popups-update_popup",
      method: "PATCH",
      scope: "gathering",
      arguments: {
        body: {
          fields: expect.arrayContaining(["start_date", "end_date"]),
        },
      },
    })
  })

  it("builds a human-readable mutation preview from live references", async () => {
    const attendeeId = "11111111-1111-4111-8111-111111111111"
    const productId = "22222222-2222-4222-8222-222222222222"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(
        response({
          id: attendeeId,
          popup_id: "popup-1",
          name: "Maria Brown",
          email: "maria@example.com",
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: productId,
          popup_id: "popup-1",
          name: "VIP Pass",
          price: "599.00",
          total_stock_cap: null,
          total_stock_remaining: null,
          is_active: true,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.preview("add_attendee_ticket", context, {
        path: { attendee_id: attendeeId },
        body: { items: [{ product_id: productId, quantity: 1 }] },
      }),
    ).resolves.toMatchObject({
      context: {
        activeGathering: { id: "popup-1", name: "Gathering" },
        targetGatherings: [{ id: "popup-1", name: "Gathering" }],
        crossContext: false,
        resolution: "verified",
      },
      title: "Add a ticket to an attendee",
      actionLabel: "Add ticket to Maria Brown",
      entities: [
        {
          role: "Attendee",
          primary: "Maria Brown",
          secondary: "maria@example.com",
        },
        {
          role: "Product",
          primary: "VIP Pass",
          details: expect.arrayContaining([
            { label: "Price", value: "599.00" },
            { label: "Stock", value: "Unlimited" },
          ]),
        },
      ],
      changes: [{ label: "Quantity", value: "1" }],
      effects: expect.arrayContaining([
        "No payment will be created or changed",
        "Product stock will be reduced",
        "A check-in code will be created or updated",
      ]),
      technicalDetails: {
        path: { attendee_id: attendeeId },
        body: {
          popup_id: "popup-1",
          items: [{ product_id: productId, quantity: 1 }],
        },
      },
    })
  })

  it("identifies a nested applicant and explains a review decision", async () => {
    const applicationId = "33333333-3333-4333-8333-333333333333"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(
        response({
          id: applicationId,
          popup_id: "popup-1",
          status: "in_review",
          human: {
            first_name: "Carol",
            last_name: "Williams",
            email: "carol@example.com",
          },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.preview("submit_review", context, {
        path: { application_id: applicationId },
        body: { decision: "yes" },
      }),
    ).resolves.toMatchObject({
      title: "Submit a positive review for Carol Williams",
      actionLabel: "Submit positive review for Carol Williams",
      entities: [
        {
          role: "Application",
          primary: "Carol Williams",
          secondary: "carol@example.com",
          details: [{ label: "Status", value: "In review" }],
        },
      ],
      changes: [{ label: "Review decision", value: "Yes (positive)" }],
      effects: [
        "Your review will be recorded for this application",
        "The application status will be recalculated using this gathering's approval strategy",
      ],
    })
  })

  it("injects context, executes a write, and sends idempotency metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(
        response(
          {
            id: "attendee-1",
            popup_id: "popup-1",
            products: [{ product_id: "product-1" }],
          },
          201,
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    const result = await catalog.execute(
      "add_attendee_ticket",
      context,
      {
        path: { attendee_id: "attendee-1" },
        body: {
          items: [{ product_id: "product-1", quantity: 1 }],
        },
      },
      { toolCallId: "tool-call-1" },
    )

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://backend:8000/api/v1/attendees/attendee-1/tickets",
    )
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(init).toMatchObject({ method: "POST" })
    expect(init.headers).toMatchObject({
      Authorization: "Bearer user-jwt",
      "X-Tenant-Id": "tenant-1",
      "X-Popup-Id": "popup-1",
      "Idempotency-Key": "ai:user-1:tool-call-1",
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      popup_id: "popup-1",
      items: [{ product_id: "product-1", quantity: 1 }],
    })
    expect(result).toMatchObject({
      status: 201,
      operation: { operationId: "add_attendee_ticket", method: "POST" },
      requestId: "request-1",
    })
  })

  it("rejects writes that combine records from multiple gatherings", async () => {
    const attendeeId = "11111111-1111-4111-8111-111111111111"
    const productId = "22222222-2222-4222-8222-222222222222"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(response({ id: attendeeId, popup_id: "popup-1" }))
      .mockResolvedValueOnce(
        response({ id: productId, popup_id: "popup-other" }),
      )
      .mockResolvedValueOnce(
        response({
          id: "popup-other",
          tenant_id: "tenant-1",
          name: "Other Gathering",
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.execute(
        "add_attendee_ticket",
        context,
        {
          path: { attendee_id: attendeeId },
          body: { items: [{ product_id: productId, quantity: 1 }] },
        },
        { toolCallId: "scoped-write" },
      ),
    ).rejects.toMatchObject({ status: 409 })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `http://backend:8000/api/v1/attendees/${attendeeId}`,
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `http://backend:8000/api/v1/products/${productId}`,
    )
  })

  it("reuses the exact same write result for a repeated tool call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(response({ popup_id: "popup-1" }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")
    const args = {
      path: { attendee_id: "attendee-1" },
      body: { items: [{ product_id: "product-1", quantity: 1 }] },
    }

    const first = await catalog.execute("add_attendee_ticket", context, args, {
      toolCallId: "same-call",
    })
    const second = await catalog.execute("add_attendee_ticket", context, args, {
      toolCallId: "same-call",
    })

    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("replays a durable result after a service restart without another write", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(openapi))
      .mockResolvedValueOnce(response({ popup_id: "popup-1" }, 201))
      .mockResolvedValueOnce(response(openapi))
    vi.stubGlobal("fetch", fetchMock)
    const executionStore = new MemoryExecutionStore()
    const args = {
      path: { attendee_id: "attendee-1" },
      body: { items: [{ product_id: "product-1", quantity: 1 }] },
    }

    const beforeRestart = new EdgeOSOperationCatalog(
      "http://backend:8000",
      executionStore,
    )
    const first = await beforeRestart.execute(
      "add_attendee_ticket",
      context,
      args,
      { toolCallId: "durable-call" },
    )
    const afterRestart = new EdgeOSOperationCatalog(
      "http://backend:8000",
      executionStore,
    )
    const replay = await afterRestart.execute(
      "add_attendee_ticket",
      context,
      args,
      { toolCallId: "durable-call" },
    )

    expect(replay).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("labels an authorized read from another gathering as cross-context", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(openapi))
        .mockResolvedValueOnce(
          response({ results: [{ popup_id: "popup-other" }] }),
        )
        .mockResolvedValueOnce(
          response({
            id: "popup-other",
            tenant_id: "tenant-1",
            name: "Other Gathering",
          }),
        ),
    )
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.execute("list_attendees", context, {
        query: { popup_id: "popup-other" },
      }),
    ).resolves.toMatchObject({
      context: {
        activeGathering: { id: "popup-1", name: "Gathering" },
        targetGatherings: [{ id: "popup-other", name: "Other Gathering" }],
        crossContext: true,
        resolution: "verified",
      },
    })
  })

  it("shows and permits an explicitly targeted cross-context write", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(openapi))
        .mockResolvedValueOnce(
          response({
            id: "popup-other",
            tenant_id: "tenant-1",
            name: "Other Gathering",
          }),
        ),
    )
    const catalog = new EdgeOSOperationCatalog("http://backend:8000")

    await expect(
      catalog.preview("popups-update_popup", context, {
        path: { popup_id: "popup-other" },
        body: { name: "Renamed" },
      }),
    ).resolves.toMatchObject({
      context: {
        activeGathering: { id: "popup-1", name: "Gathering" },
        targetGatherings: [{ id: "popup-other", name: "Other Gathering" }],
        crossContext: true,
        resolution: "verified",
      },
      warnings: [expect.stringContaining("outside the active gathering")],
      technicalDetails: {
        path: { popup_id: "popup-other" },
        body: { name: "Renamed" },
      },
    })
  })
})
