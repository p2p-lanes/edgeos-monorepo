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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-scenario-groups-"));
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

describe("scenario: Add 5 people to VIP group", () => {
  it("gets group, then adds each member sequentially", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    const members = [
      { first_name: "Alice", last_name: "A", email: "alice@example.com" },
      { first_name: "Bob", last_name: "B", email: "bob@example.com" },
      { first_name: "Carol", last_name: "C", email: "carol@example.com" },
      { first_name: "Dave", last_name: "D", email: "dave@example.com" },
      { first_name: "Eve", last_name: "E", email: "eve@example.com" },
    ];

    const addedMembers: string[] = [];

    mockFetch((url, init) => {
      // GET group details
      if (url.includes("/api/v1/groups/vip-group") && init?.method === "GET") {
        return jsonResponse({
          id: "vip-group",
          name: "VIP",
          slug: "vip",
          members: [],
        });
      }

      // POST add member
      if (
        url.includes("/api/v1/groups/my/vip-group/members") &&
        init?.method === "POST" &&
        !url.includes("/batch")
      ) {
        const body = JSON.parse(init.body as string);
        addedMembers.push(body.email);
        return jsonResponse({
          id: `h-${addedMembers.length}`,
          email: body.email,
          first_name: body.first_name,
          last_name: body.last_name,
        });
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Get the group to verify it exists
    const group = await apiGet("/api/v1/groups/vip-group");
    expect(group.id).toBe("vip-group");
    expect(group.name).toBe("VIP");

    // Step 2: Add each member
    for (const member of members) {
      const result = await apiPost("/api/v1/groups/my/vip-group/members", member);
      expect(result.email).toBe(member.email);
    }

    // Verify all 5 members were added
    expect(addedMembers).toHaveLength(5);
    expect(addedMembers).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
      "dave@example.com",
      "eve@example.com",
    ]);
  });

  it("uses batch import for efficiency", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    const members = [
      { first_name: "Alice", last_name: "A", email: "alice@example.com" },
      { first_name: "Bob", last_name: "B", email: "bob@example.com" },
      { first_name: "Carol", last_name: "C", email: "carol@example.com" },
      { first_name: "Dave", last_name: "D", email: "dave@example.com" },
      { first_name: "Eve", last_name: "E", email: "eve@example.com" },
    ];

    mockFetch((url, init) => {
      // GET group details
      if (url.includes("/api/v1/groups/vip-group") && init?.method === "GET") {
        return jsonResponse({
          id: "vip-group",
          name: "VIP",
          members: [],
        });
      }

      // POST batch add
      if (
        url.includes("/api/v1/groups/my/vip-group/members/batch") &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(init.body as string);
        expect(body.members).toHaveLength(5);
        return jsonResponse({
          imported: 5,
          errors: [],
        });
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Get the group
    const group = await apiGet("/api/v1/groups/vip-group");
    expect(group.id).toBe("vip-group");

    // Step 2: Batch add all members
    const result = await apiPost("/api/v1/groups/my/vip-group/members/batch", {
      members,
      update_existing: false,
    });
    expect(result.imported).toBe(5);
  });

  it("handles partial failure when adding members", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    let callCount = 0;

    mockFetch((url, init) => {
      if (
        url.includes("/api/v1/groups/my/vip-group/members") &&
        init?.method === "POST" &&
        !url.includes("/batch")
      ) {
        callCount++;
        // Third member fails
        if (callCount === 3) {
          return jsonResponse(
            { detail: "Email already exists in group" },
            409
          );
        }
        const body = JSON.parse(init.body as string);
        return jsonResponse({ id: `h-${callCount}`, email: body.email });
      }
      return new Response("Not found", { status: 404 });
    });

    const members = [
      { first_name: "A", last_name: "A", email: "a@test.com" },
      { first_name: "B", last_name: "B", email: "b@test.com" },
      { first_name: "C", last_name: "C", email: "c@test.com" }, // will fail
      { first_name: "D", last_name: "D", email: "d@test.com" },
      { first_name: "E", last_name: "E", email: "e@test.com" },
    ];

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const member of members) {
      try {
        await apiPost("/api/v1/groups/my/vip-group/members", member);
        results.push({ email: member.email, success: true });
      } catch (err: any) {
        results.push({
          email: member.email,
          success: false,
          error: err.message,
        });
      }
    }

    expect(results.filter((r) => r.success)).toHaveLength(4);
    expect(results.filter((r) => !r.success)).toHaveLength(1);
    expect(results[2].success).toBe(false);
    expect(results[2].error).toContain("Email already exists");
  });

  it("verifies group after adding members", async () => {
    saveConfig({ token: "test-token", tenant_id: "t1" });

    let getCallCount = 0;

    mockFetch((url, init) => {
      if (url.includes("/api/v1/groups/vip-group") && init?.method === "GET") {
        getCallCount++;
        if (getCallCount === 1) {
          // Before adding members
          return jsonResponse({
            id: "vip-group",
            name: "VIP",
            members: [],
          });
        }
        // After adding members
        return jsonResponse({
          id: "vip-group",
          name: "VIP",
          members: [
            { id: "h1", email: "a@test.com", first_name: "A", last_name: "A" },
            { id: "h2", email: "b@test.com", first_name: "B", last_name: "B" },
          ],
        });
      }

      if (
        url.includes("/api/v1/groups/my/vip-group/members/batch") &&
        init?.method === "POST"
      ) {
        return jsonResponse({ imported: 2 });
      }

      return new Response("Not found", { status: 404 });
    });

    // Step 1: Get group - no members
    const before = await apiGet("/api/v1/groups/vip-group");
    expect(before.members).toHaveLength(0);

    // Step 2: Batch add
    await apiPost("/api/v1/groups/my/vip-group/members/batch", {
      members: [
        { first_name: "A", last_name: "A", email: "a@test.com" },
        { first_name: "B", last_name: "B", email: "b@test.com" },
      ],
      update_existing: false,
    });

    // Step 3: Verify by getting group again
    const after = await apiGet("/api/v1/groups/vip-group");
    expect(after.members).toHaveLength(2);
    expect(after.members[0].email).toBe("a@test.com");
  });
});
