import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPost, apiPatch, apiDelete } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-coupons-test-"));
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

describe("coupons commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/coupons with popup_id param", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons");
        expect(url).toContain("popup_id=popup-1");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify([
            {
              id: "coupon-1",
              code: "SAVE10",
              discount_value: 10,
              max_uses: 100,
              current_uses: 5,
              is_active: true,
              popup_id: "popup-1",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiGet("/api/v1/coupons", {
        popup_id: "popup-1",
      });
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe("SAVE10");
      expect(result[0].discount_value).toBe(10);
    });

    it("passes active and search filters", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-1");
        expect(url).toContain("is_active=true");
        expect(url).toContain("search=SAVE");
        expect(url).toContain("limit=20");
        expect(url).toContain("skip=0");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await apiGet("/api/v1/coupons", {
        popup_id: "popup-1",
        is_active: true,
        search: "SAVE",
        limit: 20,
        skip: 0,
      });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });

    it("uses popup_id from config context", async () => {
      saveConfig({ token: "test-token", popup_id: "ctx-popup" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=ctx-popup");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const { getConfig } = await import("../../lib/config.ts");
      const popupId = getConfig("popup_id");
      expect(popupId).toBe("ctx-popup");

      await apiGet("/api/v1/coupons", { popup_id: popupId });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/coupons/:id", async () => {
      saveConfig({ token: "test-token" });

      const couponData = {
        id: "coupon-123",
        code: "SUMMER20",
        discount_value: 20,
        max_uses: 50,
        current_uses: 12,
        is_active: true,
        popup_id: "popup-1",
        start_date: "2025-06-01",
        end_date: "2025-08-31",
      };

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons/coupon-123");
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify(couponData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/coupons/coupon-123");
      expect(result).toEqual(couponData);
    });
  });

  describe("create", () => {
    it("sends POST with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.code).toBe("NEWCODE");
        expect(body.discount_value).toBe(15);
        return new Response(
          JSON.stringify({
            id: "coupon-new",
            code: "NEWCODE",
            discount_value: 15,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/coupons", {
        popup_id: "popup-1",
        code: "NEWCODE",
        discount_value: 15,
      });

      expect(result.id).toBe("coupon-new");
      expect(result.code).toBe("NEWCODE");
    });

    it("sends POST with all optional fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.code).toBe("FULLCODE");
        expect(body.discount_value).toBe(25);
        expect(body.max_uses).toBe(200);
        expect(body.start_date).toBe("2025-01-01");
        expect(body.end_date).toBe("2025-12-31");
        expect(body.is_active).toBe(true);
        return new Response(
          JSON.stringify({ id: "coupon-full", ...body }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/coupons", {
        popup_id: "popup-1",
        code: "FULLCODE",
        discount_value: 25,
        max_uses: 200,
        start_date: "2025-01-01",
        end_date: "2025-12-31",
        is_active: true,
      });

      expect(result.id).toBe("coupon-full");
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons/coupon-123");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.code).toBe("UPDATED");
        expect(body.discount_value).toBe(30);
        return new Response(
          JSON.stringify({
            id: "coupon-123",
            code: "UPDATED",
            discount_value: 30,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPatch("/api/v1/coupons/coupon-123", {
        code: "UPDATED",
        discount_value: 30,
      });

      expect(result.code).toBe("UPDATED");
      expect(result.discount_value).toBe(30);
    });
  });

  describe("delete", () => {
    it("sends DELETE to /api/v1/coupons/:id", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons/coupon-123");
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiDelete("/api/v1/coupons/coupon-123");
      expect(result.deleted).toBe(true);
    });
  });

  describe("validate", () => {
    it("sends POST to /api/v1/coupons/validate with popup_id and code", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons/validate");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.code).toBe("VALID10");
        return new Response(
          JSON.stringify({
            valid: true,
            discount_value: 10,
            code: "VALID10",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/coupons/validate", {
        popup_id: "popup-1",
        code: "VALID10",
      });

      expect(result.valid).toBe(true);
      expect(result.discount_value).toBe(10);
    });

    it("returns invalid for unknown coupon code", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/coupons/validate");
        const body = JSON.parse(init?.body as string);
        expect(body.code).toBe("BADCODE");
        return new Response(
          JSON.stringify({ detail: "Coupon not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiPost("/api/v1/coupons/validate", {
          popup_id: "popup-1",
          code: "BADCODE",
        })
      ).rejects.toThrow("Coupon not found");
    });
  });
});
