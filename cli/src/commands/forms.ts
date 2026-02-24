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

export function registerFormCommands(program: Command): void {
  const forms = program
    .command("forms")
    .description("Manage form fields");

  forms
    .command("list")
    .description("List form fields")
    .option("-p, --popup <id>", "Popup ID (or from context)")
    .option("-s, --search <query>", "Search form fields")
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
          search: options.search,
          limit: options.limit,
          skip: options.skip,
        };

        const data = await apiGet("/api/v1/form-fields", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((f: any) => ({
            id: f.id,
            name: f.name,
            label: f.label,
            type: f.field_type,
            section: f.section,
            position: f.position,
            required: f.required,
          }));
          process.stdout.write(
            formatTable(rows, [
              "id",
              "name",
              "label",
              "type",
              "section",
              "position",
              "required",
            ]) + "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list form fields");
        process.exit(1);
      }
    });

  forms
    .command("get <id>")
    .description("Get form field details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/form-fields/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get form field");
        process.exit(1);
      }
    });

  forms
    .command("create")
    .description("Create a new form field")
    .option("-p, --popup <id>", "Popup ID (required or from context)")
    .requiredOption("-n, --name <name>", "Field name")
    .requiredOption("--label <label>", "Field label")
    .option("-t, --type <type>", "Field type", "text")
    .option("--section <section>", "Form section")
    .option("--position <number>", "Field position", parseInt)
    .option("--required", "Field is required")
    .option("--options <options>", "Comma-separated list of options")
    .option("--placeholder <placeholder>", "Placeholder text")
    .option("--help-text <text>", "Help text")
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
          name: options.name,
          label: options.label,
        };

        if (options.type !== undefined) body.field_type = options.type;
        if (options.section !== undefined) body.section = options.section;
        if (options.position !== undefined) body.position = options.position;
        if (options.required !== undefined) body.required = options.required;
        if (options.options !== undefined) {
          body.options = options.options.split(",").map((o: string) => o.trim());
        }
        if (options.placeholder !== undefined)
          body.placeholder = options.placeholder;
        if (options.helpText !== undefined) body.help_text = options.helpText;

        const { confirmed } = await confirmCreate("form field", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/form-fields", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Form field created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create form field");
        process.exit(1);
      }
    });

  forms
    .command("update <id>")
    .description("Update a form field")
    .option("-n, --name <name>", "Field name")
    .option("--label <label>", "Field label")
    .option("-t, --type <type>", "Field type")
    .option("--section <section>", "Form section")
    .option("--position <number>", "Field position", parseInt)
    .option("--required", "Field is required")
    .option("--options <options>", "Comma-separated list of options")
    .option("--placeholder <placeholder>", "Placeholder text")
    .option("--help-text <text>", "Help text")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};

        if (options.name !== undefined) body.name = options.name;
        if (options.label !== undefined) body.label = options.label;
        if (options.type !== undefined) body.field_type = options.type;
        if (options.section !== undefined) body.section = options.section;
        if (options.position !== undefined) body.position = options.position;
        if (options.required !== undefined) body.required = options.required;
        if (options.options !== undefined) {
          body.options = options.options.split(",").map((o: string) => o.trim());
        }
        if (options.placeholder !== undefined)
          body.placeholder = options.placeholder;
        if (options.helpText !== undefined) body.help_text = options.helpText;

        const { confirmed } = await confirmUpdate(
          `/api/v1/form-fields/${id}`,
          "form field",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/form-fields/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Form field updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update form field");
        process.exit(1);
      }
    });

  forms
    .command("delete <id>")
    .description("Delete a form field")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/form-fields/${id}`,
          "form field",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/form-fields/${id}`);
        outputSuccess(`Form field deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete form field");
        process.exit(1);
      }
    });

  forms
    .command("schema <popup-id>")
    .description("Get application schema for a popup")
    .action(async (popupId: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/form-fields/schema/${popupId}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get form schema");
        process.exit(1);
      }
    });
}
