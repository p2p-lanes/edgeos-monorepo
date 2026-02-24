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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-groups-test-"));
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

describe("groups commands", () => {
  describe("list", () => {
    it("fetches groups with popup_id query param", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-1" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/groups")) {
          expect(url).toContain("popup_id=popup-1");
          return jsonResponse([
            {
              id: "g1",
              name: "VIP",
              slug: "vip",
              discount_percentage: 10,
              max_members: 50,
              is_ambassador_group: false,
              popup_id: "popup-1",
            },
          ]);
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/groups", { popup_id: "popup-1" });
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("VIP");
    });

    it("passes search and pagination params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-1");
        expect(url).toContain("search=vip");
        expect(url).toContain("limit=10");
        expect(url).toContain("skip=5");
        return jsonResponse([]);
      });

      await apiGet("/api/v1/groups", {
        popup_id: "popup-1",
        search: "vip",
        limit: 10,
        skip: 5,
      });
    });
  });

  describe("get", () => {
    it("fetches group with members by ID", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (url.includes("/api/v1/groups/g1")) {
          return jsonResponse({
            id: "g1",
            name: "VIP",
            slug: "vip",
            discount_percentage: 10,
            max_members: 50,
            members: [
              {
                id: "h1",
                first_name: "John",
                last_name: "Doe",
                email: "john@example.com",
                role: "attendee",
                organization: "ACME",
              },
            ],
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiGet("/api/v1/groups/g1");
      expect(data.id).toBe("g1");
      expect(data.name).toBe("VIP");
      expect(data.members).toHaveLength(1);
      expect(data.members[0].email).toBe("john@example.com");
    });
  });

  describe("create", () => {
    it("sends POST with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/groups") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.popup_id).toBe("popup-1");
          expect(body.name).toBe("VIP Group");
          return jsonResponse({ id: "g-new", name: "VIP Group" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/groups", {
        popup_id: "popup-1",
        name: "VIP Group",
      });
      expect(data.id).toBe("g-new");
    });

    it("sends POST with all optional fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/groups") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.popup_id).toBe("popup-1");
          expect(body.name).toBe("Ambassadors");
          expect(body.slug).toBe("ambassadors");
          expect(body.description).toBe("Ambassador group");
          expect(body.discount_percentage).toBe(15);
          expect(body.max_members).toBe(100);
          expect(body.welcome_message).toBe("Welcome!");
          expect(body.is_ambassador_group).toBe(true);
          expect(body.ambassador_id).toBe("amb-1");
          return jsonResponse({ id: "g-amb" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/groups", {
        popup_id: "popup-1",
        name: "Ambassadors",
        slug: "ambassadors",
        description: "Ambassador group",
        discount_percentage: 15,
        max_members: 100,
        welcome_message: "Welcome!",
        is_ambassador_group: true,
        ambassador_id: "amb-1",
      });
      expect(data.id).toBe("g-amb");
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/groups/g1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.name).toBe("Updated VIP");
          expect(body.discount_percentage).toBe(20);
          return jsonResponse({ id: "g1", name: "Updated VIP" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPatch("/api/v1/groups/g1", {
        name: "Updated VIP",
        discount_percentage: 20,
      });
      expect(data.name).toBe("Updated VIP");
    });
  });

  describe("delete", () => {
    it("sends DELETE request for group", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/groups/g1") && init?.method === "DELETE") {
          return jsonResponse({ deleted: true });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiDelete("/api/v1/groups/g1");
      expect(data.deleted).toBe(true);
    });
  });

  describe("add-member", () => {
    it("sends POST to add member to group", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/groups/my/g1/members") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init.body as string);
          expect(body.first_name).toBe("Jane");
          expect(body.last_name).toBe("Smith");
          expect(body.email).toBe("jane@example.com");
          return jsonResponse({ id: "h-new", email: "jane@example.com" });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/groups/my/g1/members", {
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
      });
      expect(data.email).toBe("jane@example.com");
    });

    it("sends optional member fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/groups/my/g1/members") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init.body as string);
          expect(body.telegram).toBe("@jane");
          expect(body.organization).toBe("ACME");
          expect(body.role).toBe("speaker");
          expect(body.gender).toBe("female");
          return jsonResponse({ id: "h-new" });
        }
        return new Response("Not found", { status: 404 });
      });

      await apiPost("/api/v1/groups/my/g1/members", {
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        telegram: "@jane",
        organization: "ACME",
        role: "speaker",
        gender: "female",
      });
    });
  });

  describe("remove-member", () => {
    it("sends DELETE to remove member from group", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/groups/my/g1/members/h1") &&
          init?.method === "DELETE"
        ) {
          return jsonResponse({ deleted: true });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiDelete("/api/v1/groups/my/g1/members/h1");
      expect(data.deleted).toBe(true);
    });
  });

  describe("import-members (batch)", () => {
    it("sends batch POST with members array", async () => {
      saveConfig({ token: "test-token" });

      const members = [
        { first_name: "A", last_name: "One", email: "a@example.com" },
        { first_name: "B", last_name: "Two", email: "b@example.com" },
      ];

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/groups/my/g1/members/batch") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init.body as string);
          expect(body.members).toHaveLength(2);
          expect(body.update_existing).toBe(false);
          return jsonResponse({ imported: 2 });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/groups/my/g1/members/batch", {
        members,
        update_existing: false,
      });
      expect(data.imported).toBe(2);
    });

    it("sends batch POST with update_existing flag", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/groups/my/g1/members/batch") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init.body as string);
          expect(body.update_existing).toBe(true);
          return jsonResponse({ imported: 1, updated: 1 });
        }
        return new Response("Not found", { status: 404 });
      });

      const data = await apiPost("/api/v1/groups/my/g1/members/batch", {
        members: [{ first_name: "A", last_name: "One", email: "a@example.com" }],
        update_existing: true,
      });
      expect(data.updated).toBe(1);
    });

    it("reads members from a JSON file", () => {
      const filePath = join(tempDir, "members.json");
      const members = [
        { first_name: "X", last_name: "Y", email: "x@example.com" },
      ];
      writeFileSync(filePath, JSON.stringify(members), "utf-8");

      // Simulate what the import-members command does: read file and parse
      const { readFileSync } = require("fs");
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].email).toBe("x@example.com");
    });
  });

  describe("error handling", () => {
    it("throws on 404 for non-existent group", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return jsonResponse({ detail: "Group not found" }, 404);
      });

      await expect(apiGet("/api/v1/groups/nonexistent")).rejects.toThrow(
        "Group not found"
      );
    });

    it("throws on 401 for unauthorized access", async () => {
      saveConfig({});

      mockFetch(() => {
        return jsonResponse({ detail: "Unauthorized" }, 401);
      });

      await expect(apiGet("/api/v1/groups")).rejects.toThrow(
        "Session expired"
      );
    });
  });
});
