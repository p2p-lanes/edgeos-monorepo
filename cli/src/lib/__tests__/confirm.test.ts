import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../config.ts";
import { setGlobalOptions } from "../api.ts";
import {
  computeChanges,
  confirmUpdate,
  confirmDelete,
  confirmCreate,
} from "../confirm.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;
let stdoutOutput: string;
const originalStdoutWrite = process.stdout.write;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

function captureStdout() {
  stdoutOutput = "";
  process.stdout.write = mock((chunk: any) => {
    stdoutOutput += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-confirm-test-"));
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
  captureStdout();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
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

describe("computeChanges", () => {
  it("returns only differing fields", () => {
    const current = { name: "Old", price: 200, category: "ticket" };
    const proposed = { name: "New", price: 300 };

    const changes = computeChanges(current, proposed);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ field: "name", from: "Old", to: "New" });
    expect(changes[1]).toEqual({ field: "price", from: 200, to: 300 });
  });

  it("returns empty when values match", () => {
    const current = { name: "Ticket", price: 200 };
    const proposed = { name: "Ticket", price: 200 };

    const changes = computeChanges(current, proposed);

    expect(changes).toHaveLength(0);
  });

  it("handles undefined current values", () => {
    const current = { name: "Ticket" };
    const proposed = { name: "Ticket", description: "A ticket" };

    const changes = computeChanges(current, proposed);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      field: "description",
      from: undefined,
      to: "A ticket",
    });
  });

  it("handles nested objects via JSON comparison", () => {
    const current = { options: { a: 1, b: 2 } };
    const proposed = { options: { a: 1, b: 3 } };

    const changes = computeChanges(current, proposed);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("options");
  });

  it("treats identical objects as no change", () => {
    const current = { options: { a: 1, b: 2 } };
    const proposed = { options: { a: 1, b: 2 } };

    const changes = computeChanges(current, proposed);

    expect(changes).toHaveLength(0);
  });
});

describe("confirmUpdate", () => {
  it("with --yes returns confirmed without fetching", async () => {
    saveConfig({ token: "test-token" });

    // No mockFetch set — if it tries to fetch, it will use the real fetch and fail
    const result = await confirmUpdate(
      "/api/v1/products/prod-1",
      "product",
      { price: 300 },
      { yes: true }
    );

    expect(result.confirmed).toBe(true);
  });

  it("with --dry-run fetches + displays + returns not confirmed", async () => {
    saveConfig({ token: "test-token" });

    mockFetch((url) => {
      return new Response(
        JSON.stringify({
          id: "prod-1",
          name: "Ticket",
          price: 200,
          category: "ticket",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmUpdate(
      "/api/v1/products/prod-1",
      "product",
      { price: 300 },
      { dryRun: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("Proposed changes");
    expect(stdoutOutput).toContain("prod-1");
    expect(stdoutOutput).toContain("price");
    expect(stdoutOutput).toContain("200");
    expect(stdoutOutput).toContain("300");
  });

  it("with --dry-run --json outputs JSON changeset", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({ id: "prod-1", name: "Ticket", price: 200 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmUpdate(
      "/api/v1/products/prod-1",
      "product",
      { price: 300 },
      { dryRun: true, json: true }
    );

    expect(result.confirmed).toBe(false);
    const parsed = JSON.parse(stdoutOutput.split("---")[2].trim());
    expect(parsed).toBeArray();
    expect(parsed[0].field).toBe("price");
    expect(parsed[0].from).toBe(200);
    expect(parsed[0].to).toBe(300);
  });

  it("returns not confirmed when no changes detected", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({ name: "Ticket", price: 200 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmUpdate(
      "/api/v1/products/prod-1",
      "product",
      { price: 200 },
      {}
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("No changes detected");
  });

  it("with --yes and --dry-run still shows preview", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({ name: "Ticket", price: 200 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmUpdate(
      "/api/v1/products/prod-1",
      "product",
      { price: 300 },
      { yes: true, dryRun: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("Proposed changes");
  });
});

describe("confirmDelete", () => {
  it("with --yes returns confirmed without fetching", async () => {
    saveConfig({ token: "test-token" });

    const result = await confirmDelete(
      "/api/v1/products/prod-1",
      "product",
      { yes: true }
    );

    expect(result.confirmed).toBe(true);
  });

  it("with --dry-run shows resource details and returns not confirmed", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({
          id: "prod-1",
          name: "Ticket A",
          price: 200,
          category: "ticket",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmDelete(
      "/api/v1/products/prod-1",
      "product",
      { dryRun: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("Will delete product prod-1");
    expect(stdoutOutput).toContain("Ticket A");
    expect(stdoutOutput).toContain("200");
  });

  it("with --dry-run --json outputs JSON", async () => {
    saveConfig({ token: "test-token" });

    mockFetch(() => {
      return new Response(
        JSON.stringify({
          id: "prod-1",
          name: "Ticket A",
          price: 200,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const result = await confirmDelete(
      "/api/v1/products/prod-1",
      "product",
      { dryRun: true, json: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain('"name": "Ticket A"');
  });
});

describe("confirmCreate", () => {
  it("with --yes returns confirmed immediately", async () => {
    const result = await confirmCreate(
      "product",
      { name: "New", price: 100 },
      { yes: true }
    );

    expect(result.confirmed).toBe(true);
  });

  it("with --dry-run shows proposed body and returns not confirmed", async () => {
    const result = await confirmCreate(
      "product",
      { name: "Ticket B", price: 300, category: "ticket" },
      { dryRun: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("Will create product");
    expect(stdoutOutput).toContain("Ticket B");
    expect(stdoutOutput).toContain("300");
    expect(stdoutOutput).toContain("ticket");
  });

  it("with --dry-run --json outputs JSON body", async () => {
    const result = await confirmCreate(
      "product",
      { name: "Ticket B", price: 300 },
      { dryRun: true, json: true }
    );

    expect(result.confirmed).toBe(false);
    const output = stdoutOutput.split("---")[2].trim();
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("Ticket B");
    expect(parsed.price).toBe(300);
  });

  it("with --yes and --dry-run still shows preview", async () => {
    const result = await confirmCreate(
      "product",
      { name: "New", price: 100 },
      { yes: true, dryRun: true }
    );

    expect(result.confirmed).toBe(false);
    expect(stdoutOutput).toContain("Will create product");
  });
});
