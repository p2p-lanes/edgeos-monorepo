import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig, setConfig } from "../../lib/config.ts";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-scenario-popup-"));
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

describe("Scenario: Create a new popup called Summer 2026", () => {
  it("creates a popup, sets it as active, and verifies context", async () => {
    saveConfig({ token: "test-token" });

    let callCount = 0;

    mockFetch((url, init) => {
      callCount++;

      // Step 1: Create the popup
      if (init?.method === "POST" && url.includes("/api/v1/popups")) {
        const body = JSON.parse(init.body as string);
        expect(body.name).toBe("Summer 2026");
        expect(body.slug).toBe("summer-2026");
        expect(body.status).toBe("draft");
        return new Response(
          JSON.stringify({
            id: "popup-summer-2026",
            name: "Summer 2026",
            slug: "summer-2026",
            status: "draft",
            start_date: "2026-06-01",
            end_date: "2026-08-31",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Step 2: Fetch popup for `use` command
      if (
        init?.method === "GET" &&
        url.includes("/api/v1/popups/popup-summer-2026")
      ) {
        return new Response(
          JSON.stringify({
            id: "popup-summer-2026",
            name: "Summer 2026",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Create the popup
    const created = await apiPost("/api/v1/popups", {
      name: "Summer 2026",
      slug: "summer-2026",
      status: "draft",
    });
    expect(created.id).toBe("popup-summer-2026");
    expect(created.name).toBe("Summer 2026");

    // Step 2: Set it as active context (simulating `popups use`)
    const popup = await apiGet(`/api/v1/popups/${created.id}`);
    expect(popup.name).toBe("Summer 2026");
    setConfig("popup_id", created.id);

    // Verify the context is set
    expect(getConfig("popup_id")).toBe("popup-summer-2026");

    // Verify both API calls were made
    expect(callCount).toBe(2);
  });

  it("handles error during popup creation gracefully", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({ detail: "Popup with this slug already exists" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(
      apiPost("/api/v1/popups", {
        name: "Summer 2026",
        slug: "summer-2026",
      })
    ).rejects.toThrow("Popup with this slug already exists");

    // Config should not be changed
    expect(getConfig("popup_id")).toBeUndefined();
  });
});
