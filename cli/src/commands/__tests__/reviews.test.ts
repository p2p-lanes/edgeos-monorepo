import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-reviews-test-"));
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

describe("reviews commands", () => {
  describe("pending", () => {
    it("calls GET /api/v1/applications/pending-review", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/applications/pending-review");
        return new Response(
          JSON.stringify([
            {
              id: "app-1",
              status: "in review",
              human: { email: "john@example.com" },
              popup_id: "popup-1",
            },
            {
              id: "app-2",
              status: "in review",
              human: { email: "jane@example.com" },
              popup_id: "popup-1",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiGet("/api/v1/applications/pending-review");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("app-1");
      expect(result[1].id).toBe("app-2");
    });

    it("passes popup_id and pagination params", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-ctx" });

      mockFetch((url) => {
        expect(url).toContain("popup_id=popup-ctx");
        expect(url).toContain("limit=5");
        expect(url).toContain("skip=10");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const popupId = getConfig("popup_id");
      await apiGet("/api/v1/applications/pending-review", {
        popup_id: popupId,
        limit: 5,
        skip: 10,
      });

      const fetchMock = globalThis.fetch as any;
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("calls GET /api/v1/applications/{id}/reviews", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/applications/app-1/reviews");
        return new Response(
          JSON.stringify([
            {
              id: "review-1",
              reviewer: { email: "reviewer@example.com" },
              decision: "yes",
              notes: "Looks good",
              created_at: "2026-01-20T10:00:00Z",
            },
            {
              id: "review-2",
              reviewer: { email: "reviewer2@example.com" },
              decision: "strong_yes",
              notes: null,
              created_at: "2026-01-21T10:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiGet("/api/v1/applications/app-1/reviews");
      expect(result).toHaveLength(2);
      expect(result[0].decision).toBe("yes");
      expect(result[1].decision).toBe("strong_yes");
    });
  });

  describe("summary", () => {
    it("calls GET /api/v1/applications/{id}/reviews/summary", async () => {
      saveConfig({ token: "test-token" });

      const summaryData = {
        total_reviews: 5,
        strong_yes: 2,
        yes: 1,
        no: 1,
        strong_no: 1,
        weighted_score: 0.6,
      };

      mockFetch((url) => {
        expect(url).toContain(
          "/api/v1/applications/app-1/reviews/summary"
        );
        return new Response(JSON.stringify(summaryData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await apiGet(
        "/api/v1/applications/app-1/reviews/summary"
      );
      expect(result.total_reviews).toBe(5);
      expect(result.strong_yes).toBe(2);
      expect(result.yes).toBe(1);
      expect(result.no).toBe(1);
      expect(result.strong_no).toBe(1);
      expect(result.weighted_score).toBe(0.6);
    });
  });

  describe("mine", () => {
    it("calls GET /api/v1/applications/my-reviews", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        expect(url).toContain("/api/v1/applications/my-reviews");
        return new Response(
          JSON.stringify([
            {
              id: "review-1",
              application_id: "app-1",
              decision: "yes",
              notes: "Good fit",
              created_at: "2026-01-20T10:00:00Z",
            },
            {
              id: "review-2",
              application_id: "app-2",
              decision: "no",
              notes: null,
              created_at: "2026-01-21T10:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await apiGet("/api/v1/applications/my-reviews");
      expect(result).toHaveLength(2);
      expect(result[0].application_id).toBe("app-1");
      expect(result[0].decision).toBe("yes");
      expect(result[1].application_id).toBe("app-2");
      expect(result[1].decision).toBe("no");
    });
  });
});
