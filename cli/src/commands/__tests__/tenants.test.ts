import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, loadConfig, setConfig, getConfig } from "../../lib/config.ts";
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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-tenants-test-"));
  originalEnv = {
    EDGEOS_CONFIG_DIR: process.env.EDGEOS_CONFIG_DIR,
    EDGEOS_API_URL: process.env.EDGEOS_API_URL,
    EDGEOS_TOKEN: process.env.EDGEOS_TOKEN,
    EDGEOS_TENANT_ID: process.env.EDGEOS_TENANT_ID,
  };
  process.env.EDGEOS_CONFIG_DIR = tempDir;
  delete process.env.EDGEOS_API_URL;
  delete process.env.EDGEOS_TOKEN;
  delete process.env.EDGEOS_TENANT_ID;
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

describe("tenants commands", () => {
  describe("list", () => {
    it("fetches tenants list", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/tenants")) {
          return jsonResponse([
            {
              id: "t1",
              name: "Tenant One",
              slug: "tenant-one",
              sender_email: "hello@tenant.com",
            },
            {
              id: "t2",
              name: "Tenant Two",
              slug: "tenant-two",
              sender_email: null,
            },
          ]);
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/tenants");
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("Tenant One");
      expect(data[1].slug).toBe("tenant-two");
    });

    it("passes search and pagination params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("search=tenant");
        expect(url).toContain("limit=10");
        expect(url).toContain("skip=0");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/tenants", {
        search: "tenant",
        limit: 10,
        skip: 0,
      });
    });
  });

  describe("get", () => {
    it("fetches tenant by ID", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/tenants/t1")) {
          return jsonResponse({
            id: "t1",
            name: "Tenant One",
            slug: "tenant-one",
            sender_email: "hello@tenant.com",
            sender_name: "Tenant One",
            image_url: "https://img.example.com/logo.png",
            icon_url: "https://img.example.com/icon.png",
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/tenants/t1");
      expect(data.id).toBe("t1");
      expect(data.name).toBe("Tenant One");
      expect(data.sender_email).toBe("hello@tenant.com");
      expect(data.image_url).toBe("https://img.example.com/logo.png");
    });

    it("throws on 404 for non-existent tenant", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Tenant not found" }, 404);
      });

      await expect(apiGet("/api/v1/tenants/nonexistent")).rejects.toThrow(
        "Tenant not found"
      );
    });
  });

  describe("create", () => {
    it("sends POST with name only", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/tenants") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.name).toBe("New Tenant");
          return jsonResponse({ id: "t-new", name: "New Tenant" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/tenants", {
        name: "New Tenant",
      });
      expect(data.id).toBe("t-new");
    });

    it("sends POST with all fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/tenants") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.name).toBe("Full Tenant");
          expect(body.slug).toBe("full-tenant");
          expect(body.sender_email).toBe("send@tenant.com");
          expect(body.sender_name).toBe("Full Tenant Sender");
          expect(body.image_url).toBe("https://img.example.com/logo.png");
          expect(body.icon_url).toBe("https://img.example.com/icon.png");
          return jsonResponse({ id: "t-full" });
        }
        return new Response("Not found", { status: 404 });
      });

      await apiPost("/api/v1/tenants", {
        name: "Full Tenant",
        slug: "full-tenant",
        sender_email: "send@tenant.com",
        sender_name: "Full Tenant Sender",
        image_url: "https://img.example.com/logo.png",
        icon_url: "https://img.example.com/icon.png",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/tenants/t1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.name).toBe("Updated Tenant");
          expect(body.sender_email).toBe("new@tenant.com");
          return jsonResponse({ id: "t1", name: "Updated Tenant" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/tenants/t1", {
        name: "Updated Tenant",
        sender_email: "new@tenant.com",
      });
      expect(data.name).toBe("Updated Tenant");
    });
  });

  describe("delete", () => {
    it("sends DELETE request for tenant", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/tenants/t1") && init?.method === "DELETE") {
          return jsonResponse({ deleted: true });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiDelete("/api/v1/tenants/t1");
      expect(data.deleted).toBe(true);
    });
  });

  describe("use", () => {
    it("fetches tenant and stores tenant_id in config", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/tenants/t1")) {
          return jsonResponse({
            id: "t1",
            name: "My Tenant",
            slug: "my-tenant",
          });
        }
        return new Response("Not found", { status: 404 });
      });

      // Simulate what "tenants use" does:
      const data = await apiGet("/api/v1/tenants/t1");
      setConfig("tenant_id", "t1");

      expect(data.name).toBe("My Tenant");
      expect(getConfig("tenant_id")).toBe("t1");
    });

    it("updates existing tenant_id in config", async () => {
      saveConfig({ token: "test-token", tenant_id: "old-tenant" });

      mockFetch((url) => {
        if (url.includes("/api/v1/tenants/t2")) {
          return jsonResponse({ id: "t2", name: "New Tenant" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/tenants/t2");
      setConfig("tenant_id", "t2");

      expect(getConfig("tenant_id")).toBe("t2");
      // Verify old config keys are preserved
      const config = loadConfig();
      expect(config.token).toBe("test-token");
    });

    it("throws on 404 for non-existent tenant in use", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Tenant not found" }, 404);
      });

      await expect(apiGet("/api/v1/tenants/bad-id")).rejects.toThrow(
        "Tenant not found"
      );

      // Config should not have been updated
      expect(getConfig("tenant_id")).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws on 401 for unauthorized access", async () => {
      saveConfig({});

      mockFetch(() => {
        return jsonResponse({ detail: "Unauthorized" }, 401);
      });

      await expect(apiGet("/api/v1/tenants")).rejects.toThrow(
        "Session expired"
      );
    });

    it("throws on 403 for non-superadmin", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Superadmin access required" }, 403);
      });

      await expect(apiPost("/api/v1/tenants", { name: "test" })).rejects.toThrow(
        "Superadmin access required"
      );
    });
  });
});
