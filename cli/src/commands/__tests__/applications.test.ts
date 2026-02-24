import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig } from "../../lib/config.ts";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-apps-test-"));
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

const sampleApplication = {
  id: "app-1",
  status: "in review",
  popup_id: "popup-1",
  submitted_at: "2026-01-15T10:00:00Z",
  human: {
    email: "john@example.com",
    first_name: "John",
    last_name: "Doe",
  },
  attendees: [],
};

describe("applications commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/applications with search and status params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/applications");
        expect(url).toContain("search=john");
        expect(url).toContain("status=accepted");
        expect(url).toContain("limit=20");
        return new Response(JSON.stringify([sampleApplication]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/applications", {
        search: "john",
        status: "accepted",
        limit: 20,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("app-1");
    });

    it("includes popup_id from config context", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-ctx" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-ctx");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      // Simulate what the command does: resolve popup_id from config
      const popupId = getConfig("popup_id");
      await apiGet("/api/v1/applications", { popup_id: popupId });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });

    it("prefers popup flag over config context", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-ctx" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-flag");
        expect(url).not.toContain("popup-ctx");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      // When --popup flag is provided, it takes precedence
      const popupId = "popup-flag"; // from options.popup
      await apiGet("/api/v1/applications", { popup_id: popupId });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/applications/{id} and returns full details", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/applications/app-1");
        return new Response(JSON.stringify(sampleApplication), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet("/api/v1/applications/app-1");
      expect(result.id).toBe("app-1");
      expect(result.human.email).toBe("john@example.com");
      expect(result.human.first_name).toBe("John");
      expect(result.human.last_name).toBe("Doe");
      expect(result.attendees).toEqual([]);
    });
  });

  describe("create", () => {
    it("calls POST /api/v1/applications with required and optional fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-1");
        expect(body.email).toBe("john@example.com");
        expect(body.first_name).toBe("John");
        expect(body.last_name).toBe("Doe");
        expect(body.telegram).toBe("@johndoe");
        expect(body.organization).toBe("ACME");
        expect(body.role).toBe("engineer");
        return new Response(
          JSON.stringify({ id: "app-new", ...body }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/applications", {
        popup_id: "popup-1",
        email: "john@example.com",
        first_name: "John",
        last_name: "Doe",
        telegram: "@johndoe",
        organization: "ACME",
        role: "engineer",
      });
      expect(result.id).toBe("app-new");
    });

    it("uses popup_id from config when not provided via flag", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-ctx" });

      mockFetch((url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.popup_id).toBe("popup-ctx");
        return new Response(
          JSON.stringify({ id: "app-ctx", popup_id: "popup-ctx" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      // Simulate command resolving popup_id from config
      const popupId = getConfig("popup_id");
      const result = await apiPost("/api/v1/applications", {
        popup_id: popupId,
        email: "test@example.com",
      });
      expect(result.popup_id).toBe("popup-ctx");
    });
  });

  describe("update", () => {
    it("calls PATCH /api/v1/applications/{id} with fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications/app-1");
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("accepted");
        expect(body.first_name).toBe("Jane");
        return new Response(
          JSON.stringify({ id: "app-1", status: "accepted", human: { first_name: "Jane" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPatch("/api/v1/applications/app-1", {
        status: "accepted",
        first_name: "Jane",
      });
      expect(result.status).toBe("accepted");
    });
  });

  describe("delete", () => {
    it("calls DELETE /api/v1/applications/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications/app-1");
        expect(init?.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      });

      const result = await apiDelete("/api/v1/applications/app-1");
      expect(result).toBeNull();
    });
  });

  describe("approve", () => {
    it("calls POST /api/v1/applications/{id}/reviews with decision=yes", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications/app-1/reviews");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.decision).toBe("yes");
        return new Response(
          JSON.stringify({ id: "review-1", decision: "yes", application_id: "app-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/applications/app-1/reviews", {
        decision: "yes",
      });
      expect(result.decision).toBe("yes");
    });
  });

  describe("reject", () => {
    it("calls POST /api/v1/applications/{id}/reviews with decision=no", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications/app-1/reviews");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.decision).toBe("no");
        return new Response(
          JSON.stringify({ id: "review-2", decision: "no", application_id: "app-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/applications/app-1/reviews", {
        decision: "no",
      });
      expect(result.decision).toBe("no");
    });
  });

  describe("review", () => {
    it("calls POST /api/v1/applications/{id}/reviews with decision and notes", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        expect(url).toContain("/api/v1/applications/app-1/reviews");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.decision).toBe("strong_yes");
        expect(body.notes).toBe("Great applicant");
        return new Response(
          JSON.stringify({
            id: "review-3",
            decision: "strong_yes",
            notes: "Great applicant",
            application_id: "app-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/applications/app-1/reviews", {
        decision: "strong_yes",
        notes: "Great applicant",
      });
      expect(result.decision).toBe("strong_yes");
      expect(result.notes).toBe("Great applicant");
    });

    it("sends review without notes when not provided", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        const body = JSON.parse(init?.body as string);
        expect(body.decision).toBe("no");
        expect(body.notes).toBeUndefined();
        return new Response(
          JSON.stringify({ id: "review-4", decision: "no" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiPost("/api/v1/applications/app-1/reviews", {
        decision: "no",
      });
      expect(result.decision).toBe("no");
    });
  });
});
