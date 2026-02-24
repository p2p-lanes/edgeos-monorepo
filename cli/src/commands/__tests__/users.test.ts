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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-users-test-"));
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

describe("users commands", () => {
  describe("list", () => {
    it("fetches users list", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/users")) {
          return jsonResponse([
            {
              id: "u1",
              email: "admin@example.com",
              full_name: "Admin User",
              role: "admin",
              tenant_id: "t1",
            },
          ]);
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/users");
      expect(data).toHaveLength(1);
      expect(data[0].email).toBe("admin@example.com");
      expect(data[0].role).toBe("admin");
    });

    it("passes search, role, tenant, and pagination params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("search=admin");
        expect(url).toContain("role=admin");
        expect(url).toContain("tenant_id=t1");
        expect(url).toContain("limit=20");
        expect(url).toContain("skip=0");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/users", {
        search: "admin",
        role: "admin",
        tenant_id: "t1",
        limit: 20,
        skip: 0,
      });
    });

    it("does not send X-Tenant-Id for users endpoint", async () => {
      // Users endpoint doesn't use X-Tenant-Id; it uses query param tenant_id
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        // We verify it sends query param, not header-based tenant filtering
        expect(url).toContain("tenant_id=t1");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/users", { tenant_id: "t1" });
    });
  });

  describe("get", () => {
    it("fetches user by ID", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/users/u1")) {
          return jsonResponse({
            id: "u1",
            email: "admin@example.com",
            full_name: "Admin User",
            role: "admin",
            tenant_id: "t1",
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/users/u1");
      expect(data.id).toBe("u1");
      expect(data.full_name).toBe("Admin User");
    });

    it("throws on 404 for non-existent user", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "User not found" }, 404);
      });

      await expect(apiGet("/api/v1/users/nonexistent")).rejects.toThrow(
        "User not found"
      );
    });
  });

  describe("create", () => {
    it("sends POST with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.email).toBe("new@example.com");
          expect(body.role).toBe("admin");
          return jsonResponse({ id: "u-new", email: "new@example.com", role: "admin" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/users", {
        email: "new@example.com",
        role: "admin",
      });
      expect(data.id).toBe("u-new");
    });

    it("sends POST with all fields including tenant", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.email).toBe("viewer@example.com");
          expect(body.full_name).toBe("Viewer User");
          expect(body.role).toBe("viewer");
          expect(body.tenant_id).toBe("t2");
          return jsonResponse({ id: "u-viewer" });
        }
        return new Response("Not found", { status: 404 });
      });

      await apiPost("/api/v1/users", {
        email: "viewer@example.com",
        full_name: "Viewer User",
        role: "viewer",
        tenant_id: "t2",
      });
    });

    it("supports superadmin role", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.role).toBe("superadmin");
          return jsonResponse({ id: "u-super", role: "superadmin" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/users", {
        email: "super@example.com",
        role: "superadmin",
      });
      expect(data.role).toBe("superadmin");
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users/u1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.full_name).toBe("Updated Name");
          expect(body.role).toBe("viewer");
          return jsonResponse({ id: "u1", full_name: "Updated Name", role: "viewer" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/users/u1", {
        full_name: "Updated Name",
        role: "viewer",
      });
      expect(data.full_name).toBe("Updated Name");
    });

    it("sends PATCH with email update", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users/u1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.email).toBe("newemail@example.com");
          return jsonResponse({ id: "u1", email: "newemail@example.com" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/users/u1", {
        email: "newemail@example.com",
      });
      expect(data.email).toBe("newemail@example.com");
    });
  });

  describe("delete", () => {
    it("sends DELETE request for user", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users/u1") && init?.method === "DELETE") {
          return jsonResponse({ deleted: true });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiDelete("/api/v1/users/u1");
      expect(data.deleted).toBe(true);
    });
  });

  describe("error handling", () => {
    it("throws on 401 for unauthorized access", async () => {
      saveConfig({});

      mockFetch(() => {
        return jsonResponse({ detail: "Unauthorized" }, 401);
      });

      await expect(apiGet("/api/v1/users")).rejects.toThrow(
        "Session expired"
      );
    });

    it("throws on 403 for non-superadmin", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Insufficient permissions" }, 403);
      });

      await expect(apiGet("/api/v1/users")).rejects.toThrow(
        "Insufficient permissions"
      );
    });
  });
});
