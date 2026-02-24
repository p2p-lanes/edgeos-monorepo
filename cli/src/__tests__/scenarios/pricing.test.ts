import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPatch } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-pricing-test-"));
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

describe("agentic scenario: increase all product prices by $100", () => {
  it("lists products then updates each with price + 100", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    const products = [
      { id: "prod-1", name: "Ticket A", price: 200, category: "ticket", is_active: true },
      { id: "prod-2", name: "Ticket B", price: 350, category: "ticket", is_active: true },
      { id: "prod-3", name: "Housing", price: 500, category: "housing", is_active: true },
    ];

    const updatedProducts: Record<string, number> = {};

    mockFetch((url, init) => {
      // Handle list request
      if (
        url.includes("/api/v1/products") &&
        !url.includes("/api/v1/products/prod-") &&
        init?.method === "GET"
      ) {
        return new Response(JSON.stringify(products), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle individual PATCH requests
      if (init?.method === "PATCH" && url.includes("/api/v1/products/")) {
        const body = JSON.parse(init?.body as string);
        const id = url.split("/api/v1/products/")[1].split("?")[0];
        updatedProducts[id] = body.price;
        return new Response(
          JSON.stringify({ id, price: body.price }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: List all products
    const allProducts = await apiGet("/api/v1/products", {
      popup_id: "popup-1",
    });
    expect(allProducts).toHaveLength(3);

    // Step 2: Update each product with price + 100
    const priceIncrease = 100;
    for (const product of allProducts) {
      const newPrice = product.price + priceIncrease;
      await apiPatch(`/api/v1/products/${product.id}`, {
        price: newPrice,
      });
    }

    // Verify all products were updated
    expect(Object.keys(updatedProducts)).toHaveLength(3);
    expect(updatedProducts["prod-1"]).toBe(300); // 200 + 100
    expect(updatedProducts["prod-2"]).toBe(450); // 350 + 100
    expect(updatedProducts["prod-3"]).toBe(600); // 500 + 100
  });

  it("handles empty product list gracefully", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    mockFetch((url, init) => {
      if (url.includes("/api/v1/products") && init?.method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const allProducts = await apiGet("/api/v1/products", {
      popup_id: "popup-1",
    });
    expect(allProducts).toHaveLength(0);

    // No updates should be needed
    const fetchMock = globalThis.fetch as any;
    expect(fetchMock.mock.calls).toHaveLength(1); // Only the list call
  });

  it("stops on error during update", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    const products = [
      { id: "prod-1", name: "Ticket A", price: 200 },
      { id: "prod-2", name: "Ticket B", price: 350 },
    ];

    mockFetch((url, init) => {
      if (
        url.includes("/api/v1/products") &&
        !url.includes("/api/v1/products/prod-") &&
        init?.method === "GET"
      ) {
        return new Response(JSON.stringify(products), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // First update succeeds, second fails
      if (url.includes("prod-1") && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ id: "prod-1", price: 300 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.includes("prod-2") && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ detail: "Product not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const allProducts = await apiGet("/api/v1/products", {
      popup_id: "popup-1",
    });

    // First update succeeds
    const result1 = await apiPatch(`/api/v1/products/${allProducts[0].id}`, {
      price: allProducts[0].price + 100,
    });
    expect(result1.price).toBe(300);

    // Second update fails
    await expect(
      apiPatch(`/api/v1/products/${allProducts[1].id}`, {
        price: allProducts[1].price + 100,
      })
    ).rejects.toThrow("Product not found");
  });
});
