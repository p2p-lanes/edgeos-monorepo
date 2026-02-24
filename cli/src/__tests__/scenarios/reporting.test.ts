import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig, setConfig } from "../../lib/config.ts";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-scenario-report-"));
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

describe("Scenario: How many attendees for popup X?", () => {
  it("fetches dashboard stats and reports attendee counts", async () => {
    saveConfig({ token: "test-token" });

    const dashboardStats = {
      applications: {
        total: 150,
        draft: 10,
        in_review: 20,
        accepted: 100,
        rejected: 15,
        withdrawn: 5,
      },
      attendees: {
        total: 120,
        main: 80,
        spouse: 25,
        kid: 15,
      },
      payments: {
        total: 90,
        pending: 10,
        approved: 75,
        rejected: 5,
        total_revenue: 45000,
      },
    };

    mockFetch((url) => {
      expect(url).toContain("/api/v1/dashboard/stats");
      expect(url).toContain("popup_id=popup-summer");
      return new Response(JSON.stringify(dashboardStats), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    // Simulate the dashboard command with --popup flag
    const result = await apiGet("/api/v1/dashboard/stats", {
      popup_id: "popup-summer",
    });

    // Agent can answer: "There are 120 total attendees (80 main, 25 spouses, 15 kids)"
    expect(result.attendees.total).toBe(120);
    expect(result.attendees.main).toBe(80);
    expect(result.attendees.spouse).toBe(25);
    expect(result.attendees.kid).toBe(15);
  });

  it("uses popup context when set and reports stats", async () => {
    saveConfig({ token: "test-token" });

    // Step 1: Set popup context
    mockFetch((url, init) => {
      // First call: fetch popup for `use`
      if (url.includes("/api/v1/popups/popup-summer")) {
        return new Response(
          JSON.stringify({ id: "popup-summer", name: "Summer 2026" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Second call: dashboard stats
      if (url.includes("/api/v1/dashboard/stats")) {
        expect(url).toContain("popup_id=popup-summer");
        return new Response(
          JSON.stringify({
            applications: { total: 50 },
            attendees: { total: 30, main: 20, spouse: 7, kid: 3 },
            payments: { total: 25, total_revenue: 12500 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Use popup (simulating `edgeos popups use popup-summer`)
    const popup = await apiGet("/api/v1/popups/popup-summer");
    setConfig("popup_id", popup.id);
    expect(getConfig("popup_id")).toBe("popup-summer");

    // Step 2: Get dashboard stats using context
    const popupId = getConfig("popup_id");
    const stats = await apiGet("/api/v1/dashboard/stats", {
      popup_id: popupId,
    });

    expect(stats.attendees.total).toBe(30);
    expect(stats.applications.total).toBe(50);
    expect(stats.payments.total_revenue).toBe(12500);
  });

  it("handles popup not found error", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({ detail: "Popup not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(
      apiGet("/api/v1/dashboard/stats", { popup_id: "nonexistent" })
    ).rejects.toThrow("Popup not found");
  });
});
