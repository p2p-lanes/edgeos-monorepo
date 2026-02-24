import { Command } from "commander";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import {
  outputResult,
  outputError,
  outputSuccess,
  formatTable,
  extractResults,
} from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

function resolvePopupId(options: any): string | undefined {
  return options.popup || getConfig("popup_id");
}

export function registerTemplateCommands(program: Command): void {
  const templates = program
    .command("templates")
    .description("Manage email templates");

  templates
    .command("list")
    .description("List email templates")
    .option("-p, --popup <id>", "Popup ID (or from context)")
    .option("-l, --limit <number>", "Limit number of results", parseInt)
    .option("--skip <number>", "Skip number of results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: popupId,
          limit: options.limit,
          skip: options.skip,
        };

        const data = await apiGet("/api/v1/email-templates", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((t: any) => ({
            id: t.id,
            type: t.template_type,
            subject: t.subject,
            active: t.is_active,
            popup_id: t.popup_id,
            updated_at: t.updated_at,
          }));
          process.stdout.write(
            formatTable(rows, [
              "id",
              "type",
              "subject",
              "active",
              "popup_id",
              "updated_at",
            ]) + "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list templates");
        process.exit(1);
      }
    });

  templates
    .command("types")
    .description("List available template types")
    .action(async (_, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet("/api/v1/email-templates/types");

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((t: any) => ({
            type: t.type,
            label: t.label,
            description: t.description,
            category: t.category,
          }));
          process.stdout.write(
            formatTable(rows, ["type", "label", "description", "category"]) +
              "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list template types");
        process.exit(1);
      }
    });

  templates
    .command("get <id>")
    .description("Get template details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/email-templates/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get template");
        process.exit(1);
      }
    });

  templates
    .command("create")
    .description("Create a new email template")
    .option("-p, --popup <id>", "Popup ID (required or from context)")
    .requiredOption("-t, --type <type>", "Template type")
    .option("-s, --subject <subject>", "Email subject")
    .requiredOption("--html-content <html>", "HTML content")
    .option("--active", "Set template as active")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const body: Record<string, any> = {
          popup_id: popupId,
          template_type: options.type,
          html_content: options.htmlContent,
        };

        if (options.subject !== undefined) body.subject = options.subject;
        if (options.active !== undefined) body.is_active = options.active;

        const { confirmed } = await confirmCreate("template", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/email-templates", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Template created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create template");
        process.exit(1);
      }
    });

  templates
    .command("update <id>")
    .description("Update an email template")
    .option("-s, --subject <subject>", "Email subject")
    .option("--html-content <html>", "HTML content")
    .option("--active", "Set template as active")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};

        if (options.subject !== undefined) body.subject = options.subject;
        if (options.htmlContent !== undefined)
          body.html_content = options.htmlContent;
        if (options.active !== undefined) body.is_active = options.active;

        const { confirmed } = await confirmUpdate(
          `/api/v1/email-templates/${id}`,
          "template",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/email-templates/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Template updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update template");
        process.exit(1);
      }
    });

  templates
    .command("delete <id>")
    .description("Delete an email template")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/email-templates/${id}`,
          "template",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/email-templates/${id}`);
        outputSuccess(`Template deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete template");
        process.exit(1);
      }
    });

  templates
    .command("preview")
    .description("Preview a rendered email template")
    .requiredOption("--html-content <html>", "HTML content")
    .requiredOption("-t, --type <type>", "Template type")
    .option("-s, --subject <subject>", "Email subject")
    .option("--variables <json>", "Preview variables as JSON string")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const body: Record<string, any> = {
          html_content: options.htmlContent,
          template_type: options.type,
        };

        if (options.subject !== undefined) body.subject = options.subject;
        if (options.variables !== undefined) {
          body.preview_variables = JSON.parse(options.variables);
        }

        const data = await apiPost("/api/v1/email-templates/preview", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          // Output the rendered HTML directly
          if (typeof data === "string") {
            process.stdout.write(data + "\n");
          } else if (data.html) {
            process.stdout.write(data.html + "\n");
          } else {
            outputResult(data, { json: false });
          }
        }
      } catch (err: any) {
        outputError(err.message || "Failed to preview template");
        process.exit(1);
      }
    });

  templates
    .command("send-test")
    .description("Send a test email")
    .requiredOption("--html-content <html>", "HTML content")
    .requiredOption("-t, --type <type>", "Template type")
    .option("-s, --subject <subject>", "Email subject")
    .requiredOption("--to-email <email>", "Recipient email address")
    .option("--variables <json>", "Custom variables as JSON string")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const body: Record<string, any> = {
          html_content: options.htmlContent,
          template_type: options.type,
          to_email: options.toEmail,
        };

        if (options.subject !== undefined) body.subject = options.subject;
        if (options.variables !== undefined) {
          body.custom_variables = JSON.parse(options.variables);
        }

        const data = await apiPost("/api/v1/email-templates/send-test", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Test email sent to ${options.toEmail}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to send test email");
        process.exit(1);
      }
    });
}
