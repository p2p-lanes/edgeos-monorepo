import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { apiGet, apiPost } from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-scenario-review-"));
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

describe("Scenario: Approve all pending applications", () => {
  it("lists pending applications then approves each one", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    const pendingApps = [
      {
        id: "app-1",
        status: "in review",
        human: { email: "alice@example.com" },
        popup_id: "popup-1",
      },
      {
        id: "app-2",
        status: "in review",
        human: { email: "bob@example.com" },
        popup_id: "popup-1",
      },
      {
        id: "app-3",
        status: "in review",
        human: { email: "charlie@example.com" },
        popup_id: "popup-1",
      },
    ];

    const approvedReviews: string[] = [];

    mockFetch((url, init) => {
      // Step 1: List pending reviews
      if (url.includes("/api/v1/applications/pending-review")) {
        return new Response(JSON.stringify(pendingApps), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Step 2: Approve each application
      const reviewMatch = url.match(
        /\/api\/v1\/applications\/(app-\d+)\/reviews/
      );
      if (reviewMatch && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        expect(body.decision).toBe("yes");
        approvedReviews.push(reviewMatch[1]);
        return new Response(
          JSON.stringify({
            id: `review-${reviewMatch[1]}`,
            decision: "yes",
            application_id: reviewMatch[1],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Get pending applications
    const pending = await apiGet("/api/v1/applications/pending-review", {
      popup_id: "popup-1",
    });
    expect(pending).toHaveLength(3);

    // Step 2: Approve each one
    for (const app of pending) {
      const review = await apiPost(
        `/api/v1/applications/${app.id}/reviews`,
        { decision: "yes" }
      );
      expect(review.decision).toBe("yes");
      expect(review.application_id).toBe(app.id);
    }

    // Verify all three were approved
    expect(approvedReviews).toEqual(["app-1", "app-2", "app-3"]);
    expect(approvedReviews).toHaveLength(3);
  });

  it("handles empty pending list gracefully", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-1" });

    mockFetch((url) => {
      if (url.includes("/api/v1/applications/pending-review")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const pending = await apiGet("/api/v1/applications/pending-review", {
      popup_id: "popup-1",
    });
    expect(pending).toHaveLength(0);
    // No approvals needed - scenario complete
  });

  it("handles approval failure for one application without stopping others", async () => {
    saveConfig({ token: "test-token" });

    const pendingApps = [
      { id: "app-1", status: "in review" },
      { id: "app-2", status: "in review" },
    ];

    const approvedReviews: string[] = [];
    const failedReviews: string[] = [];

    mockFetch((url, init) => {
      if (url.includes("/api/v1/applications/pending-review")) {
        return new Response(JSON.stringify(pendingApps), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const reviewMatch = url.match(
        /\/api\/v1\/applications\/(app-\d+)\/reviews/
      );
      if (reviewMatch && init?.method === "POST") {
        // app-1 fails, app-2 succeeds
        if (reviewMatch[1] === "app-1") {
          return new Response(
            JSON.stringify({ detail: "Application already reviewed" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        approvedReviews.push(reviewMatch[1]);
        return new Response(
          JSON.stringify({
            id: `review-${reviewMatch[1]}`,
            decision: "yes",
            application_id: reviewMatch[1],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const pending = await apiGet("/api/v1/applications/pending-review");

    for (const app of pending) {
      try {
        await apiPost(`/api/v1/applications/${app.id}/reviews`, {
          decision: "yes",
        });
        approvedReviews.push(app.id);
      } catch (err: any) {
        failedReviews.push(app.id);
      }
    }

    // app-1 failed, app-2 succeeded
    expect(failedReviews).toContain("app-1");
    expect(approvedReviews).toContain("app-2");
  });
});
