import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, loadConfig, getConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import { login, authenticate, getCurrentUser } from "../../lib/auth.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-login-test-"));
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

describe("auth functions", () => {
  describe("login", () => {
    it("sends POST request with email to login endpoint", async () => {
      mockFetch((url, init) => {
        if (url.includes("/api/v1/auth/user/login")) {
          const body = JSON.parse(init?.body as string);
          expect(body.email).toBe("user@example.com");
          return new Response(
            JSON.stringify({
              message: "Verification code sent",
              email: "user@example.com",
              expires_in_minutes: 10,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await login("user@example.com");
      expect(result.message).toBe("Verification code sent");
      expect(result.email).toBe("user@example.com");
      expect(result.expires_in_minutes).toBe(10);
    });
  });

  describe("authenticate", () => {
    it("sends POST request with email and code", async () => {
      mockFetch((url, init) => {
        if (url.includes("/api/v1/auth/user/authenticate")) {
          const body = JSON.parse(init?.body as string);
          expect(body.email).toBe("user@example.com");
          expect(body.code).toBe("123456");
          return new Response(
            JSON.stringify({
              access_token: "jwt-token-abc",
              token_type: "bearer",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await authenticate("user@example.com", "123456");
      expect(result.access_token).toBe("jwt-token-abc");
      expect(result.token_type).toBe("bearer");
    });

    it("token can be stored in config after authenticate", async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            access_token: "jwt-token-stored",
            token_type: "bearer",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const result = await authenticate("user@example.com", "123456");

      // Simulate what the login command does
      saveConfig({
        token: result.access_token,
        user_email: "user@example.com",
      });

      const config = loadConfig();
      expect(config.token).toBe("jwt-token-stored");
      expect(config.user_email).toBe("user@example.com");
    });
  });

  describe("logout", () => {
    it("clears token from config", () => {
      saveConfig({
        token: "old-token",
        user_email: "user@example.com",
        api_url: "http://test:8000",
      });

      // Simulate what the logout command does
      const config = loadConfig();
      delete config.token;
      delete config.user_email;
      saveConfig(config);

      const updated = loadConfig();
      expect(updated.token).toBeUndefined();
      expect(updated.user_email).toBeUndefined();
      expect(updated.api_url).toBe("http://test:8000");
    });
  });

  describe("getCurrentUser (whoami)", () => {
    it("fetches current user from /api/v1/users/me", async () => {
      saveConfig({ token: "valid-token" });

      mockFetch((url, init) => {
        if (url.includes("/api/v1/users/me")) {
          expect(init?.headers).toBeDefined();
          const headers = init!.headers as Record<string, string>;
          expect(headers["Authorization"]).toBe("Bearer valid-token");
          return new Response(
            JSON.stringify({
              id: "user-123",
              email: "user@example.com",
              role: "admin",
              tenant_id: "tenant-456",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const user = await getCurrentUser();
      expect(user.id).toBe("user-123");
      expect(user.email).toBe("user@example.com");
      expect(user.role).toBe("admin");
      expect(user.tenant_id).toBe("tenant-456");
    });

    it("throws on 401 when token is expired", async () => {
      saveConfig({ token: "expired-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Token expired" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(getCurrentUser()).rejects.toThrow(
        "Session expired. Please run `edgeos login`"
      );
    });
  });

  describe("status", () => {
    it("shows connection info from config", () => {
      saveConfig({
        api_url: "http://prod:8000",
        token: "my-token",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        user_email: "user@example.com",
      });

      // Simulate what the status command reads
      const apiUrl = getConfig("api_url") || "http://localhost:8000";
      const token = getConfig("token");
      const tenantId = getConfig("tenant_id");
      const popupId = getConfig("popup_id");
      const email = getConfig("user_email");

      expect(apiUrl).toBe("http://prod:8000");
      expect(token).toBe("my-token");
      expect(tenantId).toBe("tenant-1");
      expect(popupId).toBe("popup-1");
      expect(email).toBe("user@example.com");
    });

    it("shows defaults when no config exists", () => {
      const apiUrl = getConfig("api_url") || "http://localhost:8000";
      const token = getConfig("token");

      expect(apiUrl).toBe("http://localhost:8000");
      expect(token).toBeUndefined();
    });
  });
});
