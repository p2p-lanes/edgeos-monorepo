import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../config.ts";
import {
  apiClient,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  setGlobalOptions,
} from "../api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-api-test-"));
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
  // Reset global options
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

describe("apiClient", () => {
  it("adds Authorization header when token is in config", async () => {
    saveConfig({ token: "test-token-123" });

    mockFetch((url, init) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test");

    const fetchMock = globalThis.fetch as any;
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer test-token-123");
  });

  it("adds X-Tenant-Id header when tenant_id is in config", async () => {
    saveConfig({ tenant_id: "tenant-abc" });

    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test");

    const fetchMock = globalThis.fetch as any;
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Tenant-Id"]).toBe("tenant-abc");
  });

  it("throws 'Session expired' on 401 response", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(apiGet("/api/v1/test")).rejects.toThrow(
      "Session expired. Please run `edgeos login`"
    );
  });

  it("throws appropriate error on 404 response", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(
        JSON.stringify({ detail: "Resource not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    await expect(apiGet("/api/v1/test")).rejects.toThrow(
      "Resource not found"
    );
  });

  it("throws with validation error details on 422", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(
        JSON.stringify({
          detail: [
            { loc: ["body", "email"], msg: "field required", type: "value_error" },
          ],
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    await expect(apiGet("/api/v1/test")).rejects.toThrow("field required");
  });

  it("encodes query params correctly", async () => {
    saveConfig({});

    mockFetch((url) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test", {
      search: "hello world",
      limit: 10,
      active: true,
    });

    const fetchMock = globalThis.fetch as any;
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("search=hello+world");
    expect(url).toContain("limit=10");
    expect(url).toContain("active=true");
  });

  it("skips undefined query params", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test", { search: undefined, limit: 5 });

    const fetchMock = globalThis.fetch as any;
    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain("search");
    expect(url).toContain("limit=5");
  });

  it("uses globalOptions override for apiUrl", async () => {
    saveConfig({ api_url: "http://config-url:8000" });
    setGlobalOptions({ apiUrl: "http://override-url:9000" });

    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test");

    const fetchMock = globalThis.fetch as any;
    const [url] = fetchMock.mock.calls[0];
    expect(url).toStartWith("http://override-url:9000");
  });

  it("uses globalOptions override for tenantId", async () => {
    saveConfig({ tenant_id: "config-tenant" });
    setGlobalOptions({ tenantId: "override-tenant" });

    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test");

    const fetchMock = globalThis.fetch as any;
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Tenant-Id"]).toBe("override-tenant");
  });

  it("uses default base URL when none is configured", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiGet("/api/v1/test");

    const fetchMock = globalThis.fetch as any;
    const [url] = fetchMock.mock.calls[0];
    expect(url).toStartWith("http://localhost:8000");
  });

  it("sends body as JSON for POST requests", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiPost("/api/v1/items", { name: "test", value: 42 });

    const fetchMock = globalThis.fetch as any;
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "test", value: 42 });
  });

  it("sends PATCH requests correctly", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiPatch("/api/v1/items/1", { name: "updated" });

    const fetchMock = globalThis.fetch as any;
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
  });

  it("sends DELETE requests correctly", async () => {
    saveConfig({});

    mockFetch(() => {
      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await apiDelete("/api/v1/items/1");

    const fetchMock = globalThis.fetch as any;
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });

  it("returns parsed JSON response", async () => {
    saveConfig({});

    const responseData = { id: 1, name: "test", active: true };
    mockFetch(() => {
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await apiGet("/api/v1/test");
    expect(result).toEqual(responseData);
  });
});
