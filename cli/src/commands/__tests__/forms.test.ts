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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-forms-test-"));
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

describe("forms commands", () => {
  describe("list", () => {
    it("calls GET /api/v1/form-fields with popup_id param", async () => {
      saveConfig({ token: "test-token", popup_id: "popup-1" });

      const mockFields = [
        {
          id: "field-1",
          name: "full_name",
          label: "Full Name",
          field_type: "text",
          section: "personal",
          position: 1,
          required: true,
        },
        {
          id: "field-2",
          name: "email",
          label: "Email Address",
          field_type: "email",
          section: "personal",
          position: 2,
          required: true,
        },
      ];

      mockFetch((url) => {
        if (url.includes("/api/v1/form-fields") && url.includes("popup_id=popup-1")) {
          return new Response(JSON.stringify(mockFields), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/form-fields", { popup_id: "popup-1" });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("full_name");
      expect(result[1].name).toBe("email");
    });

    it("passes search and pagination params", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url) => {
        if (
          url.includes("/api/v1/form-fields") &&
          url.includes("search=name") &&
          url.includes("limit=10") &&
          url.includes("skip=5")
        ) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/form-fields", {
        popup_id: "popup-1",
        search: "name",
        limit: 10,
        skip: 5,
      });
      expect(result).toEqual([]);
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/form-fields/{id}", async () => {
      saveConfig({ token: "test-token" });

      const mockField = {
        id: "field-1",
        name: "full_name",
        label: "Full Name",
        field_type: "text",
        section: "personal",
        position: 1,
        required: true,
        options: null,
        placeholder: "Enter your full name",
        help_text: "Please enter your legal name",
        popup_id: "popup-1",
      };

      mockFetch((url) => {
        if (url.includes("/api/v1/form-fields/field-1")) {
          return new Response(JSON.stringify(mockField), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/form-fields/field-1");
      expect(result.id).toBe("field-1");
      expect(result.name).toBe("full_name");
      expect(result.label).toBe("Full Name");
      expect(result.placeholder).toBe("Enter your full name");
    });

    it("throws on 404 when field does not exist", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Form field not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(apiGet("/api/v1/form-fields/nonexistent")).rejects.toThrow(
        "Form field not found"
      );
    });
  });

  describe("create", () => {
    it("sends POST with required fields and popup_id", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.popup_id).toBe("popup-1");
          expect(body.name).toBe("company");
          expect(body.label).toBe("Company Name");
          expect(body.field_type).toBe("text");
          return new Response(
            JSON.stringify({
              id: "field-new",
              ...body,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/form-fields", {
        popup_id: "popup-1",
        name: "company",
        label: "Company Name",
        field_type: "text",
      });
      expect(result.id).toBe("field-new");
      expect(result.name).toBe("company");
    });

    it("handles options as array from comma-separated input", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.options).toEqual(["Option A", "Option B", "Option C"]);
          expect(body.field_type).toBe("select");
          return new Response(
            JSON.stringify({ id: "field-select", ...body }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      // Simulate what the CLI does: split comma-separated string into array
      const optionsStr = "Option A, Option B, Option C";
      const optionsArray = optionsStr.split(",").map((o) => o.trim());

      const result = await apiPost("/api/v1/form-fields", {
        popup_id: "popup-1",
        name: "preference",
        label: "Preference",
        field_type: "select",
        options: optionsArray,
      });
      expect(result.options).toEqual(["Option A", "Option B", "Option C"]);
    });

    it("sends all optional fields when provided", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.section).toBe("details");
          expect(body.position).toBe(3);
          expect(body.required).toBe(true);
          expect(body.placeholder).toBe("Enter value");
          expect(body.help_text).toBe("Help info");
          return new Response(
            JSON.stringify({ id: "field-full", ...body }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPost("/api/v1/form-fields", {
        popup_id: "popup-1",
        name: "bio",
        label: "Biography",
        field_type: "textarea",
        section: "details",
        position: 3,
        required: true,
        placeholder: "Enter value",
        help_text: "Help info",
      });
      expect(result.id).toBe("field-full");
      expect(result.section).toBe("details");
    });
  });

  describe("update", () => {
    it("sends PATCH with updated fields", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields/field-1") &&
          init?.method === "PATCH"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.label).toBe("Updated Label");
          expect(body.position).toBe(5);
          return new Response(
            JSON.stringify({
              id: "field-1",
              name: "full_name",
              label: "Updated Label",
              position: 5,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPatch("/api/v1/form-fields/field-1", {
        label: "Updated Label",
        position: 5,
      });
      expect(result.label).toBe("Updated Label");
      expect(result.position).toBe(5);
    });

    it("can update options array", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields/field-2") &&
          init?.method === "PATCH"
        ) {
          const body = JSON.parse(init?.body as string);
          expect(body.options).toEqual(["New A", "New B"]);
          return new Response(
            JSON.stringify({ id: "field-2", options: body.options }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiPatch("/api/v1/form-fields/field-2", {
        options: ["New A", "New B"],
      });
      expect(result.options).toEqual(["New A", "New B"]);
    });
  });

  describe("delete", () => {
    it("sends DELETE /api/v1/form-fields/{id}", async () => {
      saveConfig({ token: "test-token" });

      mockFetch((url, init) => {
        if (
          url.includes("/api/v1/form-fields/field-1") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiDelete("/api/v1/form-fields/field-1");
      expect(result.deleted).toBe(true);
    });

    it("throws on 404 when field does not exist", async () => {
      saveConfig({ token: "test-token" });

      mockFetch(() => {
        return new Response(
          JSON.stringify({ detail: "Form field not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      await expect(
        apiDelete("/api/v1/form-fields/nonexistent")
      ).rejects.toThrow("Form field not found");
    });
  });

  describe("schema", () => {
    it("calls GET /api/v1/form-fields/schema/{popup_id}", async () => {
      saveConfig({ token: "test-token" });

      const mockSchema = {
        popup_id: "popup-1",
        sections: [
          {
            name: "personal",
            fields: [
              {
                name: "full_name",
                label: "Full Name",
                field_type: "text",
                required: true,
              },
              {
                name: "email",
                label: "Email",
                field_type: "email",
                required: true,
              },
            ],
          },
        ],
      };

      mockFetch((url) => {
        if (url.includes("/api/v1/form-fields/schema/popup-1")) {
          return new Response(JSON.stringify(mockSchema), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/form-fields/schema/popup-1");
      expect(result.popup_id).toBe("popup-1");
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].name).toBe("personal");
      expect(result.sections[0].fields).toHaveLength(2);
    });

    it("returns schema with multiple sections", async () => {
      saveConfig({ token: "test-token" });

      const mockSchema = {
        popup_id: "popup-2",
        sections: [
          { name: "personal", fields: [{ name: "name", label: "Name", field_type: "text", required: true }] },
          { name: "professional", fields: [{ name: "company", label: "Company", field_type: "text", required: false }] },
        ],
      };

      mockFetch((url) => {
        if (url.includes("/api/v1/form-fields/schema/popup-2")) {
          return new Response(JSON.stringify(mockSchema), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await apiGet("/api/v1/form-fields/schema/popup-2");
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].name).toBe("personal");
      expect(result.sections[1].name).toBe("professional");
    });
  });
});
