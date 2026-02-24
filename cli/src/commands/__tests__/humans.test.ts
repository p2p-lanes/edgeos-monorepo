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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-humans-test-"));
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

describe("humans commands", () => {
  describe("list", () => {
    it("fetches humans list", async () => {
      saveConfig({ token: "test-token", tenant_id: "t1" });

      mockFetch((url) => {
        if (url.includes("/api/v1/humans")) {
          return jsonResponse([
            {
              id: "h1",
              email: "alice@example.com",
              first_name: "Alice",
              last_name: "Smith",
              organization: "ACME",
              role: "attendee",
            },
            {
              id: "h2",
              email: "bob@example.com",
              first_name: "Bob",
              last_name: "Jones",
              organization: null,
              role: "speaker",
            },
          ]);
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/humans");
      expect(data).toHaveLength(2);
      expect(data[0].email).toBe("alice@example.com");
      expect(data[1].first_name).toBe("Bob");
    });

    it("passes search and pagination params", async () => {
      saveConfig({ token: "test-token", tenant_id: "t1" });

      mockFetch((url) => {
        expect(url).toContain("search=alice");
        expect(url).toContain("limit=5");
        expect(url).toContain("skip=10");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/humans", {
        search: "alice",
        limit: 5,
        skip: 10,
      });
    });

    it("sends X-Tenant-Id header from config", async () => {
      saveConfig({ token: "test-token", tenant_id: "tenant-abc" });

      mockFetch((url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["X-Tenant-Id"]).toBe("tenant-abc");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/humans");
    });
  });

  describe("get", () => {
    it("fetches human by ID", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/humans/h1")) {
          return jsonResponse({
            id: "h1",
            email: "alice@example.com",
            first_name: "Alice",
            last_name: "Smith",
            telegram: "@alice",
            organization: "ACME",
            role: "attendee",
            gender: "female",
            age: 30,
            residence: "New York",
            picture_url: null,
            red_flag: false,
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/humans/h1");
      expect(data.id).toBe("h1");
      expect(data.email).toBe("alice@example.com");
      expect(data.first_name).toBe("Alice");
      expect(data.telegram).toBe("@alice");
      expect(data.age).toBe(30);
      expect(data.red_flag).toBe(false);
    });

    it("throws on 404 for non-existent human", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Human not found" }, 404);
      });

      await expect(apiGet("/api/v1/humans/nonexistent")).rejects.toThrow(
        "Human not found"
      );
    });
  });

  describe("create", () => {
    it("sends POST with email only", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/humans") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.email).toBe("new@example.com");
          return jsonResponse({ id: "h-new", email: "new@example.com" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/humans", {
        email: "new@example.com",
      });
      expect(data.id).toBe("h-new");
    });

    it("sends POST with all fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/humans") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.email).toBe("full@example.com");
          expect(body.first_name).toBe("Full");
          expect(body.last_name).toBe("Person");
          expect(body.telegram).toBe("@full");
          expect(body.organization).toBe("BigCo");
          expect(body.role).toBe("speaker");
          expect(body.gender).toBe("male");
          expect(body.age).toBe(25);
          expect(body.residence).toBe("London");
          return jsonResponse({ id: "h-full" });
        }
        return new Response("Not found", { status: 404 });
      });

      await apiPost("/api/v1/humans", {
        email: "full@example.com",
        first_name: "Full",
        last_name: "Person",
        telegram: "@full",
        organization: "BigCo",
        role: "speaker",
        gender: "male",
        age: 25,
        residence: "London",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/humans/h1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.first_name).toBe("Updated");
          expect(body.organization).toBe("NewOrg");
          return jsonResponse({ id: "h1", first_name: "Updated" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/humans/h1", {
        first_name: "Updated",
        organization: "NewOrg",
      });
      expect(data.first_name).toBe("Updated");
    });

    it("sends PATCH with red_flag boolean", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/humans/h1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.red_flag).toBe(true);
          return jsonResponse({ id: "h1", red_flag: true });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/humans/h1", {
        red_flag: true,
      });
      expect(data.red_flag).toBe(true);
    });
  });

  describe("error handling", () => {
    it("throws on 401 for unauthorized access", async () => {
      saveConfig({});

      mockFetch(() => {
        return jsonResponse({ detail: "Unauthorized" }, 401);
      });

      await expect(apiGet("/api/v1/humans")).rejects.toThrow(
        "Session expired"
      );
    });

    it("throws validation error on 422", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse(
          {
            detail: [
              { loc: ["body", "email"], msg: "field required", type: "value_error" },
            ],
          },
          422
        );
      });

      await expect(
        apiPost("/api/v1/humans", {})
      ).rejects.toThrow("field required");
    });
  });
});
