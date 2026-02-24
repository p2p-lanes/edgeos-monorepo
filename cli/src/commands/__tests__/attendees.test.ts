import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPatch, apiDelete } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-attendees-test-"));
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

const sampleAttendee = {
  id: "att-1",
  name: "John Doe",
  category: "main",
  email: "john@example.com",
  check_in_code: "ABC123",
  application_id: "app-1",
  gender: "male",
};

describe("attendees commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/attendees with query params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/attendees");
        expect(url).toContain("popup_id=popup-1");
        expect(url).toContain("email=john%40example.com");
        expect(url).toContain("limit=10");
        return new Response(JSON.stringify([sampleAttendee]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/attendees", {
        popup_id: "popup-1",
        email: "john@example.com",
        limit: 10,
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("John Doe");
    });

    it("uses popup_id from config context", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-ctx" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-ctx");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const popupId = getConfig("popup_id");
      await apiGet("/api/v1/attendees", { popup_id: popupId });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });

    it("passes application_id filter", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("application_id=app-1");
        return new Response(JSON.stringify([sampleAttendee]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/attendees", {
        application_id: "app-1",
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/attendees/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/attendees/att-1");
        return new Response(JSON.stringify(sampleAttendee), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/attendees/att-1");
      expect(result.id).toBe("att-1");
      expect(result.name).toBe("John Doe");
      expect(result.email).toBe("john@example.com");
      expect(result.check_in_code).toBe("ABC123");
    });
  });

  describe("update", () => {
    it("calls PATCH /api/v1/attendees/{id} with fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/attendees/att-1");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Jane Doe");
        expect(body.email).toBe("jane@example.com");
        expect(body.gender).toBe("female");
        return new Response(
          JSON.stringify({
            ...sampleAttendee,
            name: "Jane Doe",
            email: "jane@example.com",
            gender: "female",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPatch("/api/v1/attendees/att-1", {
        name: "Jane Doe",
        email: "jane@example.com",
        gender: "female",
      });
      expect(result.name).toBe("Jane Doe");
      expect(result.email).toBe("jane@example.com");
    });
  });

  describe("delete", () => {
    it("calls DELETE /api/v1/attendees/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/attendees/att-1");
        expect(init?.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      });

      const result = await apiDelete("/api/v1/attendees/att-1");
      expect(result).toBeNull();
    });
  });

  describe("check-in", () => {
    it("calls GET /api/v1/attendees/check-in/{code}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/attendees/check-in/ABC123");
        return new Response(JSON.stringify(sampleAttendee), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/attendees/check-in/ABC123");
      expect(result.id).toBe("att-1");
      expect(result.name).toBe("John Doe");
      expect(result.check_in_code).toBe("ABC123");
    });

    it("throws on invalid check-in code", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Invalid check-in code" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      });

      await expect(
        apiGet("/api/v1/attendees/check-in/INVALID")
      ).rejects.toThrow("Invalid check-in code");
    });
  });
});
