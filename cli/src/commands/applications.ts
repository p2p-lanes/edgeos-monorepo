import { Command } from "commander";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

function resolvePopupId(options: any): string | undefined {
  return options.popup || getConfig("popup_id");
}

export function registerApplicationCommands(program: Command): void {
  const applications = program
    .command("applications")
    .description("Manage applications");

  applications
    .command("list")
    .description("List applications")
    .option("-p, --popup <id>", "Popup ID (or from context)")
    .option("--status <status>", "Filter by status (draft/in review/accepted/rejected/withdrawn)")
    .option("-s, --search <query>", "Search applications")
    .option("-l, --limit <number>", "Limit number of results", parseInt)
    .option("--skip <number>", "Skip number of results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = resolvePopupId(options);
        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: popupId,
          status: options.status,
          search: options.search,
          limit: options.limit,
          skip: options.skip,
        };
        const data = await apiGet("/api/v1/applications", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((a: any) => ({
            id: a.id,
            status: a.status,
            human_email: a.human?.email,
            human_name: a.human
              ? `${a.human.first_name || ""} ${a.human.last_name || ""}`.trim()
              : null,
            popup_id: a.popup_id,
            submitted_at: a.submitted_at,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list applications");
        process.exit(1);
      }
    });

  applications
    .command("get <id>")
    .description("Get application details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/applications/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get application");
        process.exit(1);
      }
    });

  applications
    .command("create")
    .description("Create a new application")
    .option("-p, --popup <id>", "Popup ID (required or from context)")
    .requiredOption("-e, --email <email>", "Applicant email")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--status <status>", "Application status")
    .option("--telegram <handle>", "Telegram handle")
    .option("--organization <org>", "Organization")
    .option("--role <role>", "Role")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError("Popup ID is required. Use --popup or set with `edgeos popups use <id>`");
          process.exit(1);
        }

        const body: Record<string, any> = {
          popup_id: popupId,
          email: options.email,
        };
        if (options.firstName) body.first_name = options.firstName;
        if (options.lastName) body.last_name = options.lastName;
        if (options.status) body.status = options.status;
        if (options.telegram) body.telegram = options.telegram;
        if (options.organization) body.organization = options.organization;
        if (options.role) body.role = options.role;

        const { confirmed } = await confirmCreate("application", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/applications", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Application created: ${data.id}`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create application");
        process.exit(1);
      }
    });

  applications
    .command("update <id>")
    .description("Update an application")
    .option("--status <status>", "Application status")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--telegram <handle>", "Telegram handle")
    .option("--organization <org>", "Organization")
    .option("--role <role>", "Role")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.status) body.status = options.status;
        if (options.firstName) body.first_name = options.firstName;
        if (options.lastName) body.last_name = options.lastName;
        if (options.telegram) body.telegram = options.telegram;
        if (options.organization) body.organization = options.organization;
        if (options.role) body.role = options.role;

        const { confirmed } = await confirmUpdate(
          `/api/v1/applications/${id}`,
          "application",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/applications/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Application updated: ${id}`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update application");
        process.exit(1);
      }
    });

  applications
    .command("delete <id>")
    .description("Delete an application")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/applications/${id}`,
          "application",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/applications/${id}`);
        outputSuccess(`Application deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete application");
        process.exit(1);
      }
    });

  applications
    .command("approve <id>")
    .description("Approve an application (shortcut for review with decision=yes)")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmCreate("application approval", { decision: "yes" }, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost(`/api/v1/applications/${id}/reviews`, {
          decision: "yes",
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Application ${id} approved`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to approve application");
        process.exit(1);
      }
    });

  applications
    .command("reject <id>")
    .description("Reject an application (shortcut for review with decision=no)")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmCreate("application rejection", { decision: "no" }, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost(`/api/v1/applications/${id}/reviews`, {
          decision: "no",
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Application ${id} rejected`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to reject application");
        process.exit(1);
      }
    });

  applications
    .command("review <id>")
    .description("Submit a review for an application")
    .requiredOption("-d, --decision <decision>", "Decision (strong_yes/yes/no/strong_no)")
    .option("--notes <notes>", "Review notes")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          decision: options.decision,
        };
        if (options.notes) body.notes = options.notes;

        const { confirmed } = await confirmCreate("application review", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost(`/api/v1/applications/${id}/reviews`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Review submitted for application ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to submit review");
        process.exit(1);
      }
    });
}
