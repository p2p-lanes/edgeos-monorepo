import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveConfig, getConfig } from "../../lib/config.ts";
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
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-workflow-test-"));
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

describe("multi-step workflows", () => {
  describe("set up a new popup with products and form fields", () => {
    it("creates popup, products, and form fields in sequence", async () => {
      saveConfig({ token: "test-token", tenant_id: "tenant-1" });

      // Track API calls in order
      const apiCalls: { method: string; url: string; body?: any }[] = [];

      mockFetch((url, init) => {
        const method = init?.method || "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        apiCalls.push({ method, url, body });

        // Step 1: Create popup
        if (url.includes("/api/v1/popups") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "popup-new",
              name: body.name,
              slug: body.slug || "my-popup",
              status: "draft",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Step 2: Create products
        if (url.includes("/api/v1/products") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: `product-${body.name.toLowerCase().replace(/\s/g, "-")}`,
              popup_id: body.popup_id,
              name: body.name,
              price: body.price,
              category: body.category,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Step 3: Create form fields
        if (url.includes("/api/v1/form-fields") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: `field-${body.name}`,
              popup_id: body.popup_id,
              name: body.name,
              label: body.label,
              field_type: body.field_type || "text",
              section: body.section,
              position: body.position,
              required: body.required,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response("Not found", { status: 404 });
      });

      // Step 1: Create the popup
      const popup = await apiPost("/api/v1/popups", {
        name: "Summer Popup 2025",
      });
      expect(popup.id).toBe("popup-new");
      expect(popup.name).toBe("Summer Popup 2025");

      // Simulate storing the popup_id in config (like `popups use`)
      const popupId = popup.id;

      // Step 2: Create products for this popup
      const ticket = await apiPost("/api/v1/products", {
        popup_id: popupId,
        name: "General Admission",
        price: 150,
        category: "ticket",
      });
      expect(ticket.id).toBe("product-general-admission");
      expect(ticket.popup_id).toBe("popup-new");

      const housing = await apiPost("/api/v1/products", {
        popup_id: popupId,
        name: "Shared Room",
        price: 300,
        category: "housing",
      });
      expect(housing.id).toBe("product-shared-room");
      expect(housing.popup_id).toBe("popup-new");

      // Step 3: Create form fields for the popup
      const nameField = await apiPost("/api/v1/form-fields", {
        popup_id: popupId,
        name: "full_name",
        label: "Full Name",
        field_type: "text",
        section: "personal",
        position: 1,
        required: true,
      });
      expect(nameField.id).toBe("field-full_name");
      expect(nameField.popup_id).toBe("popup-new");
      expect(nameField.required).toBe(true);

      const emailField = await apiPost("/api/v1/form-fields", {
        popup_id: popupId,
        name: "email",
        label: "Email Address",
        field_type: "email",
        section: "personal",
        position: 2,
        required: true,
      });
      expect(emailField.id).toBe("field-email");
      expect(emailField.field_type).toBe("email");

      const bioField = await apiPost("/api/v1/form-fields", {
        popup_id: popupId,
        name: "bio",
        label: "Tell us about yourself",
        field_type: "textarea",
        section: "details",
        position: 1,
        required: false,
      });
      expect(bioField.id).toBe("field-bio");
      expect(bioField.field_type).toBe("textarea");
      expect(bioField.required).toBe(false);

      // Verify total API calls
      expect(apiCalls).toHaveLength(6); // 1 popup + 2 products + 3 form fields
      expect(apiCalls[0].method).toBe("POST");
      expect(apiCalls[0].url).toContain("/api/v1/popups");
      expect(apiCalls[1].url).toContain("/api/v1/products");
      expect(apiCalls[2].url).toContain("/api/v1/products");
      expect(apiCalls[3].url).toContain("/api/v1/form-fields");
      expect(apiCalls[4].url).toContain("/api/v1/form-fields");
      expect(apiCalls[5].url).toContain("/api/v1/form-fields");
    });

    it("uses popup context from config to avoid repeating popup_id", async () => {
      // Simulate having already set a popup context
      saveConfig({
        token: "test-token",
        tenant_id: "tenant-1",
        popup_id: "popup-existing",
      });

      mockFetch((url, init) => {
        const method = init?.method || "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;

        if (url.includes("/api/v1/products") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "product-1",
              popup_id: body.popup_id,
              name: body.name,
              price: body.price,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (url.includes("/api/v1/form-fields") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "field-1",
              popup_id: body.popup_id,
              name: body.name,
              label: body.label,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response("Not found", { status: 404 });
      });

      // Read popup_id from config context (like CLI resolvePopupId does)
      const popupId = getConfig("popup_id");
      expect(popupId).toBe("popup-existing");

      // Create product using context popup_id
      const product = await apiPost("/api/v1/products", {
        popup_id: popupId,
        name: "VIP Ticket",
        price: 500,
      });
      expect(product.popup_id).toBe("popup-existing");

      // Create form field using context popup_id
      const field = await apiPost("/api/v1/form-fields", {
        popup_id: popupId,
        name: "organization",
        label: "Organization",
      });
      expect(field.popup_id).toBe("popup-existing");
    });

    it("handles auth error during multi-step workflow", async () => {
      saveConfig({ token: "expired-token", tenant_id: "tenant-1" });

      let callCount = 0;
      mockFetch((url, init) => {
        callCount++;
        const method = init?.method || "GET";

        // First call succeeds (create popup)
        if (callCount === 1 && url.includes("/api/v1/popups") && method === "POST") {
          return new Response(
            JSON.stringify({ id: "popup-new", name: "Test Popup" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Second call fails with 401 (token expired mid-workflow)
        if (callCount === 2) {
          return new Response(
            JSON.stringify({ detail: "Token expired" }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response("Not found", { status: 404 });
      });

      // Step 1 succeeds
      const popup = await apiPost("/api/v1/popups", {
        name: "Test Popup",
      });
      expect(popup.id).toBe("popup-new");

      // Step 2 fails with auth error
      await expect(
        apiPost("/api/v1/products", {
          popup_id: popup.id,
          name: "Ticket",
          price: 100,
        })
      ).rejects.toThrow("Session expired. Please run `edgeos login`");
    });

    it("creates popup with products, form fields, and email templates", async () => {
      saveConfig({ token: "test-token", tenant_id: "tenant-1" });

      mockFetch((url, init) => {
        const method = init?.method || "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;

        // Create popup
        if (url.includes("/api/v1/popups") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "popup-full",
              name: body.name,
              status: "draft",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Create product
        if (url.includes("/api/v1/products") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "product-1",
              popup_id: body.popup_id,
              name: body.name,
              price: body.price,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Create form field
        if (url.includes("/api/v1/form-fields") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "field-1",
              popup_id: body.popup_id,
              name: body.name,
              label: body.label,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Create email template
        if (url.includes("/api/v1/email-templates") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "tmpl-1",
              popup_id: body.popup_id,
              template_type: body.template_type,
              subject: body.subject,
              html_content: body.html_content,
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

      // Step 1: Create popup
      const popup = await apiPost("/api/v1/popups", {
        name: "Full Setup Popup",
      });
      const popupId = popup.id;

      // Step 2: Create product
      const product = await apiPost("/api/v1/products", {
        popup_id: popupId,
        name: "Weekend Pass",
        price: 200,
      });
      expect(product.popup_id).toBe("popup-full");

      // Step 3: Create form field
      const field = await apiPost("/api/v1/form-fields", {
        popup_id: popupId,
        name: "full_name",
        label: "Full Name",
      });
      expect(field.popup_id).toBe("popup-full");

      // Step 4: Create email template
      const template = await apiPost("/api/v1/email-templates", {
        popup_id: popupId,
        template_type: "application_received",
        subject: "Your application was received",
        html_content: "<h1>Thank you for applying!</h1>",
      });
      expect(template.popup_id).toBe("popup-full");
      expect(template.template_type).toBe("application_received");
      expect(template.is_active).toBe(true);
    });
  });
});
