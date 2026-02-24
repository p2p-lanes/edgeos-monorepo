import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-scenario-attendees-"));
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

describe("scenario: How many attendees for popup X?", () => {
  it("counts total attendees by listing all groups for a popup", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    mockFetch((url, init) => {
      // List groups for popup
      if (url.includes("/api/v1/groups") && url.includes("popup_id=popup-x") && init?.method === "GET") {
        return jsonResponse([
          { id: "g1", name: "General", popup_id: "popup-x" },
          { id: "g2", name: "VIP", popup_id: "popup-x" },
          { id: "g3", name: "Speakers", popup_id: "popup-x" },
        ]);
      }

      // Get group with members
      if (url.includes("/api/v1/groups/g1") && init?.method === "GET") {
        return jsonResponse({
          id: "g1",
          name: "General",
          members: [
            { id: "h1", email: "a@test.com" },
            { id: "h2", email: "b@test.com" },
            { id: "h3", email: "c@test.com" },
          ],
        });
      }
      if (url.includes("/api/v1/groups/g2") && init?.method === "GET") {
        return jsonResponse({
          id: "g2",
          name: "VIP",
          members: [
            { id: "h4", email: "d@test.com" },
            { id: "h5", email: "e@test.com" },
          ],
        });
      }
      if (url.includes("/api/v1/groups/g3") && init?.method === "GET") {
        return jsonResponse({
          id: "g3",
          name: "Speakers",
          members: [
            { id: "h6", email: "f@test.com" },
          ],
        });
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: List all groups for popup-x
    const groups = await apiGet("/api/v1/groups", { popup_id: "popup-x" });
    expect(groups).toHaveLength(3);

    // Step 2: Get each group with members and count
    let totalAttendees = 0;
    const groupStats: { name: string; count: number }[] = [];

    for (const group of groups) {
      const details = await apiGet(`/api/v1/groups/${group.id}`);
      const memberCount = details.members?.length || 0;
      totalAttendees += memberCount;
      groupStats.push({ name: details.name, count: memberCount });
    }

    // Verify
    expect(totalAttendees).toBe(6);
    expect(groupStats).toEqual([
      { name: "General", count: 3 },
      { name: "VIP", count: 2 },
      { name: "Speakers", count: 1 },
    ]);
  });

  it("counts unique attendees across groups (deduplication)", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    mockFetch((url, init) => {
      if (url.includes("/api/v1/groups") && url.includes("popup_id=popup-y") && init?.method === "GET") {
        return jsonResponse([
          { id: "g1", name: "General" },
          { id: "g2", name: "VIP" },
        ]);
      }

      if (url.includes("/api/v1/groups/g1") && init?.method === "GET") {
        return jsonResponse({
          id: "g1",
          name: "General",
          members: [
            { id: "h1", email: "alice@test.com" },
            { id: "h2", email: "bob@test.com" },
            { id: "h3", email: "carol@test.com" },
          ],
        });
      }
      if (url.includes("/api/v1/groups/g2") && init?.method === "GET") {
        return jsonResponse({
          id: "g2",
          name: "VIP",
          members: [
            { id: "h1", email: "alice@test.com" }, // duplicate
            { id: "h4", email: "dave@test.com" },
          ],
        });
      }

      return new Response("Not found", { status: 404 });
    });

    // List groups
    const groups = await apiGet("/api/v1/groups", { popup_id: "popup-y" });

    // Collect all unique attendee IDs
    const uniqueIds = new Set<string>();
    for (const group of groups) {
      const details = await apiGet(`/api/v1/groups/${group.id}`);
      for (const member of details.members || []) {
        uniqueIds.add(member.id);
      }
    }

    // Total members across groups: 3 + 2 = 5, but unique: 4
    expect(uniqueIds.size).toBe(4);
  });

  it("handles popup with no groups", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    mockFetch((url, init) => {
      if (url.includes("/api/v1/groups") && url.includes("popup_id=empty-popup") && init?.method === "GET") {
        return jsonResponse([]);
      }
      return new Response("Not found", { status: 404 });
    });

    const groups = await apiGet("/api/v1/groups", { popup_id: "empty-popup" });
    expect(groups).toHaveLength(0);

    // No attendees
    let totalAttendees = 0;
    for (const group of groups) {
      const details = await apiGet(`/api/v1/groups/${group.id}`);
      totalAttendees += details.members?.length || 0;
    }
    expect(totalAttendees).toBe(0);
  });

  it("composes humans list with group membership for analysis", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    mockFetch((url, init) => {
      // List humans
      if (url.includes("/api/v1/humans") && !url.includes("/api/v1/humans/") && init?.method === "GET") {
        return jsonResponse([
          { id: "h1", email: "alice@test.com", first_name: "Alice", organization: "ACME" },
          { id: "h2", email: "bob@test.com", first_name: "Bob", organization: "ACME" },
          { id: "h3", email: "carol@test.com", first_name: "Carol", organization: "BigCo" },
        ]);
      }

      // List groups for popup
      if (url.includes("/api/v1/groups") && url.includes("popup_id=popup-z") && init?.method === "GET") {
        return jsonResponse([
          { id: "g1", name: "ACME Group" },
        ]);
      }

      if (url.includes("/api/v1/groups/g1") && init?.method === "GET") {
        return jsonResponse({
          id: "g1",
          name: "ACME Group",
          members: [
            { id: "h1", email: "alice@test.com" },
            { id: "h2", email: "bob@test.com" },
          ],
        });
      }

      return new Response("Not found", { status: 404 });
    });

    // Agent composability: combine humans data with group membership
    const humans = await apiGet("/api/v1/humans");
    const groups = await apiGet("/api/v1/groups", { popup_id: "popup-z" });

    // Build membership map
    const membershipMap = new Map<string, string[]>();
    for (const group of groups) {
      const details = await apiGet(`/api/v1/groups/${group.id}`);
      for (const member of details.members || []) {
        const existing = membershipMap.get(member.id) || [];
        existing.push(group.name);
        membershipMap.set(member.id, existing);
      }
    }

    // Enrich humans with group info
    const enriched = humans.map((h: any) => ({
      ...h,
      groups: membershipMap.get(h.id) || [],
    }));

    expect(enriched[0].groups).toEqual(["ACME Group"]);
    expect(enriched[1].groups).toEqual(["ACME Group"]);
    expect(enriched[2].groups).toEqual([]); // Carol not in any group
  });
});
