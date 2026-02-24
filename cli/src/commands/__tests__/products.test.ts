import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-products-test-"));
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

describe("products commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/products with popup_id param", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-1" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products");
        expect(url).toContain("popup_id=popup-1");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify([
            {
              id: "prod-1",
              name: "Ticket A",
              price: 100,
              category: "ticket",
              is_active: true,
              slug: "ticket-a",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiGet("/api/v1/products", {
        popup_id: "popup-1",
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Ticket A");
    });

    it("passes category, search, and sort params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-1");
        expect(url).toContain("category=ticket");
        expect(url).toContain("search=VIP");
        expect(url).toContain("sort_by=price");
        expect(url).toContain("sort_order=desc");
        expect(url).toContain("limit=10");
        expect(url).toContain("skip=5");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await apiGet("/api/v1/products", {
        popup_id: "popup-1",
        category: "ticket",
        search: "VIP",
        sort_by: "price",
        sort_order: "desc",
        limit: 10,
        skip: 5,
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

      // Simulating what the command does: resolve popup from config
      const { getConfig } = await import("../../lib/config.ts");
      const popupId = getConfig("popup_id");
      expect(popupId).toBe("ctx-popup");

      await apiGet("/api/v1/products", { popup_id: popupId });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });

    it("passes is_active filter", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("is_active=true");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await apiGet("/api/v1/products", {
        popup_id: "popup-1",
        is_active: true,
      });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/products/:id", async () => {
      saveConfig({ token: "test-token" });

      const productData = {
        id: "prod-123",
        name: "VIP Ticket",
        price: 500,
        category: "ticket",
        is_active: true,
        slug: "vip-ticket",
        description: "VIP access",
        popup_id: "popup-1",
      };

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products/prod-123");
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify(productData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/products/prod-123");
      expect(result).toEqual(productData);
    });
  });

  describe("create", () => {
    it("sends POST with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.name).toBe("New Ticket");
        expect(body.price).toBe(200);
        return new Response(
          JSON.stringify({ id: "prod-new", name: "New Ticket", price: 200 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/products", {
        popup_id: "popup-1",
        name: "New Ticket",
        price: 200,
      });

      expect(result.id).toBe("prod-new");
      expect(result.name).toBe("New Ticket");
    });

    it("sends POST with all optional fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.name).toBe("Full Ticket");
        expect(body.price).toBe(300);
        expect(body.slug).toBe("full-ticket");
        expect(body.description).toBe("Full access ticket");
        expect(body.category).toBe("ticket");
        expect(body.attendee_category).toBe("main");
        expect(body.duration_type).toBe("full");
        expect(body.start_date).toBe("2025-01-01");
        expect(body.end_date).toBe("2025-12-31");
        expect(body.is_active).toBe(true);
        expect(body.exclusive).toBe(false);
        expect(body.max_quantity).toBe(100);
        return new Response(
          JSON.stringify({ id: "prod-full", ...body }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPost("/api/v1/products", {
        popup_id: "popup-1",
        name: "Full Ticket",
        price: 300,
        slug: "full-ticket",
        description: "Full access ticket",
        category: "ticket",
        attendee_category: "main",
        duration_type: "full",
        start_date: "2025-01-01",
        end_date: "2025-12-31",
        is_active: true,
        exclusive: false,
        max_quantity: 100,
      });

      expect(result.id).toBe("prod-full");
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products/prod-123");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Updated Ticket");
        expect(body.price).toBe(350);
        return new Response(
          JSON.stringify({
            id: "prod-123",
            name: "Updated Ticket",
            price: 350,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await apiPatch("/api/v1/products/prod-123", {
        name: "Updated Ticket",
        price: 350,
      });

      expect(result.name).toBe("Updated Ticket");
      expect(result.price).toBe(350);
    });
  });

  describe("delete", () => {
    it("sends DELETE to /api/v1/products/:id", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products/prod-123");
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiDelete("/api/v1/products/prod-123");
      expect(result.deleted).toBe(true);
    });
  });

  describe("import", () => {
    it("reads JSON file and calls batch API with product array", async () => {
      saveConfig({ token: "test-token" });

      // Create a temp JSON file with product data
      const importFile = join(tempDir, "products.json");
      const products = [
        { name: "Ticket A", price: 100 },
        { name: "Ticket B", price: 200 },
      ];
      writeFileSync(importFile, JSON.stringify(products));

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products/batch");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.products).toHaveLength(2);
        expect(body.products[0].name).toBe("Ticket A");
        expect(body.products[1].name).toBe("Ticket B");
        return new Response(
          JSON.stringify({ created: 2 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      // Simulate what the import command does
      const { readFileSync } = await import("fs");
      const raw = readFileSync(importFile, "utf-8");
      const data = JSON.parse(raw);
      const productList = Array.isArray(data) ? data : data.products;

      const result = await apiPost("/api/v1/products/batch", {
        popup_id: "popup-1",
        products: productList,
      });

      expect(result.created).toBe(2);
    });

    it("reads JSON file with { popup_id, products } format", async () => {
      saveConfig({ token: "test-token" });

      const importFile = join(tempDir, "products-wrapped.json");
      const data = {
        popup_id: "popup-file",
        products: [
          { name: "Merch A", price: 50 },
          { name: "Merch B", price: 75 },
        ],
      };
      writeFileSync(importFile, JSON.stringify(data));

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/products/batch");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.products).toHaveLength(2);
        return new Response(
          JSON.stringify({ created: 2 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const { readFileSync } = await import("fs");
      const raw = readFileSync(importFile, "utf-8");
      const parsed = JSON.parse(raw);
      const productList = Array.isArray(parsed) ? parsed : parsed.products;

      const result = await apiPost("/api/v1/products/batch", {
        popup_id: "popup-1",
        products: productList,
      });

      expect(result.created).toBe(2);
    });
  });
});
