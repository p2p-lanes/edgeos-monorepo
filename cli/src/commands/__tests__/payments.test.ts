import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPost, apiPatch } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-payments-test-"));
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

describe("payments commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/payments with query params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/payments");
        expect(url).toContain("popup_id=popup-1");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify([
            {
              id: "pay-1",
              status: "pending",
              amount: 500,
              currency: "USD",
              application_id: "app-1",
              created_at: "2025-01-15T10:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiGet("/api/v1/payments", {
        popup_id: "popup-1",
      });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("pending");
      expect(result[0].amount).toBe(500);
    });

    it("passes application_id and payment_status filters", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-1");
        expect(url).toContain("application_id=app-123");
        expect(url).toContain("payment_status=pending");
        expect(url).toContain("limit=10");
        expect(url).toContain("skip=5");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await apiGet("/api/v1/payments", {
        popup_id: "popup-1",
        application_id: "app-123",
        payment_status: "pending",
        limit: 10,
        skip: 5,
      });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });

    it("works without popup_id filter", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/payments");
        expect(url).toContain("payment_status=approved");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await apiGet("/api/v1/payments", {
        payment_status: "approved",
      });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/payments/:id", async () => {
      saveConfig({ token: "test-token" });

      const paymentData = {
        id: "pay-123",
        status: "pending",
        amount: 1000,
        currency: "USD",
        application_id: "app-1",
        external_id: "ext-456",
        source: "SimpleFI",
        rate: 1.0,
        created_at: "2025-01-15T10:00:00Z",
      };

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/payments/pay-123");
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify(paymentData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/payments/pay-123");
      expect(result).toEqual(paymentData);
    });
  });

  describe("approve", () => {
    it("sends POST to /api/v1/payments/:id/approve", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/payments/pay-123/approve");
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            id: "pay-123",
            status: "approved",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/payments/pay-123/approve");
      expect(result.status).toBe("approved");
    });

    it("throws on already approved payment", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Payment already approved" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiPost("/api/v1/payments/pay-123/approve")
      ).rejects.toThrow("Payment already approved");
    });
  });

  describe("update", () => {
    it("sends PATCH with status update", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/payments/pay-123");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("approved");
        return new Response(
          JSON.stringify({
            id: "pay-123",
            status: "approved",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPatch("/api/v1/payments/pay-123", {
        status: "approved",
      });

      expect(result.status).toBe("approved");
    });

    it("sends PATCH with all update fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/payments/pay-123");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("approved");
        expect(body.external_id).toBe("ext-new");
        expect(body.source).toBe("Stripe");
        expect(body.rate).toBe(1.25);
        expect(body.currency).toBe("EUR");
        return new Response(
          JSON.stringify({
            id: "pay-123",
            ...body,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPatch("/api/v1/payments/pay-123", {
        status: "approved",
        external_id: "ext-new",
        source: "Stripe",
        rate: 1.25,
        currency: "EUR",
      });

      expect(result.source).toBe("Stripe");
      expect(result.rate).toBe(1.25);
      expect(result.currency).toBe("EUR");
    });
  });
});
