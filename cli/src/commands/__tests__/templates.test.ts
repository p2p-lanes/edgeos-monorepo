import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig } from "../../lib/config.ts";
import { setGlobalOptions } from "../../lib/api.ts";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from "../../lib/api.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = mock(handler) as any;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-templates-test-"));
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

describe("templates commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/email-templates with popup_id param", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-1" });

      const mockTemplates = [
        {
          id: "tmpl-1",
          template_type: "application_received",
          subject: "Application Received",
          is_active: true,
          popup_id: "popup-1",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "tmpl-2",
          template_type: "application_accepted",
          subject: "You're In!",
          is_active: true,
          popup_id: "popup-1",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      mockFetch((url) => {
        if (
          url.includes("/api/v1/email-templates") &&
          url.includes("popup_id=popup-1")
        ) {
          return new Response(JSON.stringify(mockTemplates), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/email-templates", {
        popup_id: "popup-1",
      });
      expect(result).toHaveLength(2);
      expect(result[0].template_type).toBe("application_received");
      expect(result[1].template_type).toBe("application_accepted");
    });

    it("passes pagination params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (
          url.includes("/api/v1/email-templates") &&
          url.includes("limit=5") &&
          url.includes("skip=10")
        ) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/email-templates", {
        popup_id: "popup-1",
        limit: 5,
        skip: 10,
      });
      expect(result).toEqual([]);
    });
  });

  describe("types", () => {
    it("calls GET /api/v1/email-templates/types", async () => {
      saveConfig({ token: "test-token" });

      const mockTypes = [
        {
          type: "login_code_user",
          label: "Login Code (User)",
          description: "Login verification code for users",
          category: "authentication",
        },
        {
          type: "application_received",
          label: "Application Received",
          description: "Confirmation that application was received",
          category: "application",
        },
        {
          type: "application_accepted",
          label: "Application Accepted",
          description: "Application has been accepted",
          category: "application",
        },
        {
          type: "abandoned_cart",
          label: "Abandoned Cart",
          description: "Reminder about abandoned cart",
          category: "payment",
        },
      ];

      mockFetch((url) => {
        if (url.includes("/api/v1/email-templates/types")) {
          return new Response(JSON.stringify(mockTypes), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/email-templates/types");
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe("login_code_user");
      expect(result[3].type).toBe("abandoned_cart");
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/email-templates/{id}", async () => {
      saveConfig({ token: "test-token" });

      const mockTemplate = {
        id: "tmpl-1",
        template_type: "application_received",
        subject: "Application Received",
        html_content: "<h1>Thank you!</h1>",
        is_active: true,
        popup_id: "popup-1",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      mockFetch((url) => {
        if (url.includes("/api/v1/email-templates/tmpl-1")) {
          return new Response(JSON.stringify(mockTemplate), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/email-templates/tmpl-1");
      expect(result.id).toBe("tmpl-1");
      expect(result.template_type).toBe("application_received");
      expect(result.html_content).toBe("<h1>Thank you!</h1>");
    });

    it("throws on 404 when template does not exist", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Template not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiGet("/api/v1/email-templates/nonexistent")
      ).rejects.toThrow("Template not found");
    });
  });

  describe("create", () => {
    it("sends POST with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.popup_id).toBe("popup-1");
          expect(body.template_type).toBe("application_received");
          expect(body.html_content).toBe("<h1>Hello</h1>");
          return new Response(
            JSON.stringify({
              id: "tmpl-new",
              ...body,
              is_active: true,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates", {
        popup_id: "popup-1",
        template_type: "application_received",
        html_content: "<h1>Hello</h1>",
      });
      expect(result.id).toBe("tmpl-new");
      expect(result.template_type).toBe("application_received");
    });

    it("sends optional subject and is_active fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.subject).toBe("Welcome!");
          expect(body.is_active).toBe(false);
          return new Response(
            JSON.stringify({ id: "tmpl-opt", ...body }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates", {
        popup_id: "popup-1",
        template_type: "login_code_user",
        html_content: "<p>Code: {{code}}</p>",
        subject: "Welcome!",
        is_active: false,
      });
      expect(result.subject).toBe("Welcome!");
      expect(result.is_active).toBe(false);
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/tmpl-1") &&
          init?.method === "PATCH"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.subject).toBe("Updated Subject");
          expect(body.html_content).toBe("<h1>Updated</h1>");
          return new Response(
            JSON.stringify({
              id: "tmpl-1",
              template_type: "application_received",
              subject: "Updated Subject",
              html_content: "<h1>Updated</h1>",
              is_active: true,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPatch("/api/v1/email-templates/tmpl-1", {
        subject: "Updated Subject",
        html_content: "<h1>Updated</h1>",
      });
      expect(result.subject).toBe("Updated Subject");
      expect(result.html_content).toBe("<h1>Updated</h1>");
    });

    it("can toggle is_active", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/tmpl-1") &&
          init?.method === "PATCH"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.is_active).toBe(false);
          return new Response(
            JSON.stringify({ id: "tmpl-1", is_active: false }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPatch("/api/v1/email-templates/tmpl-1", {
        is_active: false,
      });
      expect(result.is_active).toBe(false);
    });
  });

  describe("delete", () => {
    it("sends DELETE /api/v1/email-templates/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/tmpl-1") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiDelete("/api/v1/email-templates/tmpl-1");
      expect(result.deleted).toBe(true);
    });

    it("throws on 404 when template does not exist", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Template not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiDelete("/api/v1/email-templates/nonexistent")
      ).rejects.toThrow("Template not found");
    });
  });

  describe("preview", () => {
    it("sends POST /api/v1/email-templates/preview with html and type", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/preview") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.html_content).toBe("<h1>Hello {{name}}</h1>");
          expect(body.template_type).toBe("application_received");
          return new Response(
            JSON.stringify({
              html: "<h1>Hello World</h1>",
              subject: "Preview",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates/preview", {
        html_content: "<h1>Hello {{name}}</h1>",
        template_type: "application_received",
      });
      expect(result.html).toBe("<h1>Hello World</h1>");
    });

    it("sends preview_variables when provided", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/preview") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.preview_variables).toEqual({ name: "Test User" });
          expect(body.subject).toBe("Hello");
          return new Response(
            JSON.stringify({ html: "<h1>Hello Test User</h1>" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates/preview", {
        html_content: "<h1>Hello {{name}}</h1>",
        template_type: "application_received",
        subject: "Hello",
        preview_variables: { name: "Test User" },
      });
      expect(result.html).toBe("<h1>Hello Test User</h1>");
    });
  });

  describe("send-test", () => {
    it("sends POST /api/v1/email-templates/send-test with required fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/send-test") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.html_content).toBe("<h1>Test</h1>");
          expect(body.template_type).toBe("application_received");
          expect(body.to_email).toBe("test@example.com");
          return new Response(
            JSON.stringify({
              success: true,
              message: "Test email sent",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates/send-test", {
        html_content: "<h1>Test</h1>",
        template_type: "application_received",
        to_email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("sends custom_variables and subject when provided", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/email-templates/send-test") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.subject).toBe("Test Subject");
          expect(body.custom_variables).toEqual({
            name: "Tester",
            event: "My Event",
          });
          return new Response(
            JSON.stringify({ success: true }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/email-templates/send-test", {
        html_content: "<h1>Hi {{name}}</h1>",
        template_type: "application_received",
        to_email: "test@example.com",
        subject: "Test Subject",
        custom_variables: { name: "Tester", event: "My Event" },
      });
      expect(result.success).toBe(true);
    });

    it("throws on 422 validation error", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({
            detail: [
              {
                loc: ["body", "to_email"],
                msg: "field required",
                type: "value_error",
              },
            ],
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiPost("/api/v1/email-templates/send-test", {
          html_content: "<h1>Test</h1>",
          template_type: "application_received",
        })
      ).rejects.toThrow("field required");
    });
  });
});
