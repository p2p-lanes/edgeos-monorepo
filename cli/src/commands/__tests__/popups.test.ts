import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, loadConfig, getConfig } from "../../lib/config.ts";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-popups-test-"));
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

describe("popups commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/popups with query params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/popups");
        expect(url).toContain("search=summer");
        expect(url).toContain("limit=10");
        expect(url).toContain("skip=5");
        return new Response(
          JSON.stringify([
            {
              id: "popup-1",
              name: "Summer 2026",
              slug: "summer-2026",
              status: "active",
              start_date: "2026-06-01",
              end_date: "2026-08-31",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiGet("/api/v1/popups", {
        search: "summer",
        limit: 10,
        skip: 5,
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Summer 2026");
    });

    it("calls GET /api/v1/popups without params when none provided", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/popups");
        expect(url).not.toContain("search");
        expect(url).not.toContain("limit");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/popups");
      expect(result).toEqual([]);
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/popups/{id}", async () => {
      saveConfig({ token: "test-token" });

      const popup = {
        id: "popup-1",
        name: "Summer 2026",
        slug: "summer-2026",
        status: "active",
        start_date: "2026-06-01",
        end_date: "2026-08-31",
        description: "A summer popup",
      };

      mockFetch((url) => {
        expect(url).toContain("/api/v1/popups/popup-1");
        return new Response(JSON.stringify(popup), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/popups/popup-1");
      expect(result.id).toBe("popup-1");
      expect(result.name).toBe("Summer 2026");
      expect(result.description).toBe("A summer popup");
    });

    it("throws on 404 when popup not found", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Popup not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      });

      await expect(apiGet("/api/v1/popups/nonexistent")).rejects.toThrow(
        "Popup not found"
      );
    });
  });

  describe("create", () => {
    it("calls POST /api/v1/popups with body", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/popups");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Summer 2026");
        expect(body.slug).toBe("summer-2026");
        expect(body.status).toBe("draft");
        return new Response(
          JSON.stringify({
            id: "popup-new",
            name: "Summer 2026",
            slug: "summer-2026",
            status: "draft",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/popups", {
        name: "Summer 2026",
        slug: "summer-2026",
        status: "draft",
      });
      expect(result.id).toBe("popup-new");
      expect(result.name).toBe("Summer 2026");
    });

    it("sends only provided fields in body", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Minimal Popup");
        expect(body.slug).toBeUndefined();
        expect(body.status).toBeUndefined();
        return new Response(
          JSON.stringify({ id: "popup-min", name: "Minimal Popup" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/popups", {
        name: "Minimal Popup",
      });
      expect(result.id).toBe("popup-min");
    });
  });

  describe("update", () => {
    it("calls PATCH /api/v1/popups/{id} with body", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/popups/popup-1");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Updated Name");
        expect(body.status).toBe("active");
        return new Response(
          JSON.stringify({
            id: "popup-1",
            name: "Updated Name",
            status: "active",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPatch("/api/v1/popups/popup-1", {
        name: "Updated Name",
        status: "active",
      });
      expect(result.name).toBe("Updated Name");
    });
  });

  describe("delete", () => {
    it("calls DELETE /api/v1/popups/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/popups/popup-1");
        expect(init?.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      });

      const result = await apiDelete("/api/v1/popups/popup-1");
      expect(result).toBeNull();
    });
  });

  describe("use", () => {
    it("fetches popup and sets popup_id in config", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/popups/popup-1");
        return new Response(
          JSON.stringify({ id: "popup-1", name: "Summer 2026" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      // Simulate what the use command does
      const popup = await apiGet("/api/v1/popups/popup-1");
      expect(popup.name).toBe("Summer 2026");

      // Save to config like the command does
      const { setConfig } = await import("../../lib/config.ts");
      setConfig("popup_id", "popup-1");
      expect(getConfig("popup_id")).toBe("popup-1");
    });

    it("fails if popup does not exist", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Popup not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      });

      await expect(apiGet("/api/v1/popups/nonexistent")).rejects.toThrow(
        "Popup not found"
      );

      // Config should not be changed
      expect(getConfig("popup_id")).toBeUndefined();
    });
  });
});
