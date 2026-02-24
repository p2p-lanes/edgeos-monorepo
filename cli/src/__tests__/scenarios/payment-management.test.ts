import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPost } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-paymgmt-test-"));
  originalEnv = {
    EDGEOS_CONFIG_DIR: process.env.EDGEOS_CONFIG_DIR,
    EDGEOS_API_URL: process.env.EDGEOS_API_URL,
    EDGEOS_TOKEN: process.env.EDGEOS_TOKEN,
    EDGEOS_TENANT_ID: process.env.EDGEOS_TENANT_ID,
    EDGEOS_POPUP_ID: process.env.EDGEOS_POPUP_ID,
  };
  process.env.EDGEOS_CONFIG_DIR = tempDir;
  delete process.env.EDGEOS_API_URL;
  delete process.env.EDGEOS_TOKEN;
  delete process.env.EDGEOS_TENANT_ID;
  delete process.env.EDGEOS_POPUP_ID;
  setGlobalOptions({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe("agentic scenario: approve all pending payments", () => {
  it("lists pending payments then approves each one", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    const pendingPayments = [
      {
        id: "pay-1",
        status: "pending",
        amount: 500,
        currency: "USD",
        application_id: "app-1",
        created_at: "2025-01-15T10:00:00Z",
      },
      {
        id: "pay-2",
        status: "pending",
        amount: 750,
        currency: "USD",
        application_id: "app-2",
        created_at: "2025-01-16T10:00:00Z",
      },
      {
        id: "pay-3",
        status: "pending",
        amount: 300,
        currency: "EUR",
        application_id: "app-3",
        created_at: "2025-01-17T10:00:00Z",
      },
    ];

    const approvedIds: string[] = [];

    mockFetch((url, init) => {
      // Handle list request with payment_status=pending
      if (
        url.includes("/api/v1/payments") &&
        url.includes("payment_status=pending") &&
        init?.method === "GET"
      ) {
        return new Response(JSON.stringify(pendingPayments), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle approve requests
      if (
        url.includes("/approve") &&
        init?.method === "POST"
      ) {
        const id = url.split("/api/v1/payments/")[1].split("/approve")[0];
        approvedIds.push(id);
        return new Response(
          JSON.stringify({ id, status: "approved" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: List all pending payments
    const payments = await apiGet("/api/v1/payments", {
      popup_id: "popup-1",
      payment_status: "pending",
    });
    expect(payments).toHaveLength(3);

    // Step 2: Approve each pending payment
    for (const payment of payments) {
      const result = await apiPost(
        `/api/v1/payments/${payment.id}/approve`
      );
      expect(result.status).toBe("approved");
    }

    // Verify all payments were approved
    expect(approvedIds).toHaveLength(3);
    expect(approvedIds).toContain("pay-1");
    expect(approvedIds).toContain("pay-2");
    expect(approvedIds).toContain("pay-3");
  });

  it("handles empty pending payments list", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    mockFetch((url, init) => {
      if (
        url.includes("/api/v1/payments") &&
        url.includes("payment_status=pending") &&
        init?.method === "GET"
      ) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const payments = await apiGet("/api/v1/payments", {
      popup_id: "popup-1",
      payment_status: "pending",
    });
    expect(payments).toHaveLength(0);

    // No approvals should be needed
    const fetchMock = globalThis.fetch as any;
    expect(fetchMock.mock.calls).toHaveLength(1); // Only the list call
  });

  it("continues approving even if one fails", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    const pendingPayments = [
      { id: "pay-1", status: "pending", amount: 500 },
      { id: "pay-2", status: "pending", amount: 750 },
      { id: "pay-3", status: "pending", amount: 300 },
    ];

    const approvedIds: string[] = [];
    const failedIds: string[] = [];

    mockFetch((url, init) => {
      if (
        url.includes("/api/v1/payments") &&
        url.includes("payment_status=pending") &&
        init?.method === "GET"
      ) {
        return new Response(JSON.stringify(pendingPayments), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/approve") && init?.method === "POST") {
        const id = url.split("/api/v1/payments/")[1].split("/approve")[0];

        // pay-2 fails
        if (id === "pay-2") {
          return new Response(
            JSON.stringify({ detail: "Payment cannot be approved" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        approvedIds.push(id);
        return new Response(
          JSON.stringify({ id, status: "approved" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const payments = await apiGet("/api/v1/payments", {
      popup_id: "popup-1",
      payment_status: "pending",
    });

    // Approve each, tracking successes and failures
    for (const payment of payments) {
      try {
        await apiPost(`/api/v1/payments/${payment.id}/approve`);
        approvedIds.push(payment.id);
      } catch {
        failedIds.push(payment.id);
      }
    }

    // Note: approvedIds contains both the ones tracked by mockFetch and the ones tracked in the loop
    // The mockFetch tracks pay-1 and pay-3 internally, while the loop tracks them too
    expect(failedIds).toHaveLength(1);
    expect(failedIds).toContain("pay-2");
  });

  it("processes payments from multiple popups", async () => {
    saveConfig({ token: "test-token" });

    const popup1Payments = [
      { id: "pay-1", status: "pending", amount: 500 },
    ];
    const popup2Payments = [
      { id: "pay-4", status: "pending", amount: 200 },
      { id: "pay-5", status: "pending", amount: 400 },
    ];

    const approvedIds: string[] = [];

    mockFetch((url, init) => {
      if (url.includes("/api/v1/payments") && init?.method === "GET") {
        if (url.includes("popup_id=popup-1")) {
          return new Response(JSON.stringify(popup1Payments), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("popup_id=popup-2")) {
          return new Response(JSON.stringify(popup2Payments), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (url.includes("/approve") && init?.method === "POST") {
        const id = url.split("/api/v1/payments/")[1].split("/approve")[0];
        approvedIds.push(id);
        return new Response(
          JSON.stringify({ id, status: "approved" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Process popup-1
    const payments1 = await apiGet("/api/v1/payments", {
      popup_id: "popup-1",
      payment_status: "pending",
    });
    for (const payment of payments1) {
      await apiPost(`/api/v1/payments/${payment.id}/approve`);
    }

    // Process popup-2
    const payments2 = await apiGet("/api/v1/payments", {
      popup_id: "popup-2",
      payment_status: "pending",
    });
    for (const payment of payments2) {
      await apiPost(`/api/v1/payments/${payment.id}/approve`);
    }

    expect(approvedIds).toHaveLength(3);
    expect(approvedIds).toContain("pay-1");
    expect(approvedIds).toContain("pay-4");
    expect(approvedIds).toContain("pay-5");
  });
});
