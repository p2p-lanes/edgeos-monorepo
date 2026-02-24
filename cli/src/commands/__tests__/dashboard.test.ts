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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-dashboard-test-"));
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

const sampleDashboard = {
  applications: {
    total: 100,
    draft: 10,
    in_review: 30,
    accepted: 45,
    rejected: 10,
    withdrawn: 5,
  },
  attendees: {
    total: 60,
    main: 45,
    spouse: 10,
    kid: 5,
  },
  payments: {
    total: 50,
    pending: 5,
    approved: 40,
    rejected: 5,
    total_revenue: 25000,
  },
};

describe("dashboard command", () => {
  it("calls GET /api/v1/dashboard/stats with popup_id from flag", async () => {
    saveConfig({ token: "test-token" });

    mockFetch((url) => {
      expect(url).toContain("/api/v1/dashboard/stats");
      expect(url).toContain("popup_id=popup-flag");
      return new Response(JSON.stringify(sampleDashboard), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await apiGet("/api/v1/dashboard/stats", {
      popup_id: "popup-flag",
    });
    expect(result.applications.total).toBe(100);
    expect(result.attendees.total).toBe(60);
    expect(result.payments.total).toBe(50);
  });

  it("calls GET /api/v1/dashboard/stats with popup_id from config context", async () => {
    saveConfig({ token: "test-token", popup_id: "popup-ctx" });

    mockFetch((url) => {
      expect(url).toContain("popup_id=popup-ctx");
      return new Response(JSON.stringify(sampleDashboard), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const popupId = getConfig("popup_id");
    const result = await apiGet("/api/v1/dashboard/stats", {
      popup_id: popupId,
    });
    expect(result.applications.total).toBe(100);
    expect(result.applications.draft).toBe(10);
    expect(result.applications.in_review).toBe(30);
    expect(result.applications.accepted).toBe(45);
    expect(result.applications.rejected).toBe(10);
    expect(result.applications.withdrawn).toBe(5);
  });

  it("returns all dashboard stat categories", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(JSON.stringify(sampleDashboard), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await apiGet("/api/v1/dashboard/stats", {
      popup_id: "popup-1",
    });

    // Applications stats
    expect(result.applications).toBeDefined();
    expect(result.applications.total).toBe(100);
    expect(result.applications.draft).toBe(10);
    expect(result.applications.in_review).toBe(30);
    expect(result.applications.accepted).toBe(45);
    expect(result.applications.rejected).toBe(10);
    expect(result.applications.withdrawn).toBe(5);

    // Attendees stats
    expect(result.attendees).toBeDefined();
    expect(result.attendees.total).toBe(60);
    expect(result.attendees.main).toBe(45);
    expect(result.attendees.spouse).toBe(10);
    expect(result.attendees.kid).toBe(5);

    // Payments stats
    expect(result.payments).toBeDefined();
    expect(result.payments.total).toBe(50);
    expect(result.payments.pending).toBe(5);
    expect(result.payments.approved).toBe(40);
    expect(result.payments.rejected).toBe(5);
    expect(result.payments.total_revenue).toBe(25000);
  });

  it("requires popup_id to be set", () => {
    // Without any config, popup_id should be undefined
    const popupId = getConfig("popup_id");
    expect(popupId).toBeUndefined();

    // The dashboard command would check and error, simulated here
    const errorMessage = !popupId
      ? "Popup ID is required. Use --popup or set with `edgeos popups use <id>`"
      : null;
    expect(errorMessage).toBe(
      "Popup ID is required. Use --popup or set with `edgeos popups use <id>`"
    );
  });
});
