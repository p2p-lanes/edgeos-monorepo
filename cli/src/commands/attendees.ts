import { Command } from "commander";
import { apiGet, apiPatch, apiDelete } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

export function registerAttendeeCommands(program: Command): void {
  const attendees = program
    .command("attendees")
    .description("Manage attendees");

  attendees
    .command("list")
    .description("List attendees")
    .option("-p, --popup <id>", "Popup ID (or from context)")
    .option("-e, --email <email>", "Filter by email")
    .option("-a, --application <id>", "Filter by application ID")
    .option("-l, --limit <number>", "Limit number of results", parseInt)
    .option("--skip <number>", "Skip number of results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = options.popup || getConfig("popup_id");
        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: popupId,
          email: options.email,
          application_id: options.application,
          limit: options.limit,
          skip: options.skip,
        };
        const data = await apiGet("/api/v1/attendees", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((a: any) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            email: a.email,
            check_in_code: a.check_in_code,
            application_id: a.application_id,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list attendees");
        process.exit(1);
      }
    });

  attendees
    .command("get <id>")
    .description("Get attendee details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/attendees/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get attendee");
        process.exit(1);
      }
    });

  attendees
    .command("update <id>")
    .description("Update an attendee")
    .option("-n, --name <name>", "Attendee name")
    .option("-e, --email <email>", "Attendee email")
    .option("--gender <gender>", "Attendee gender")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.name) body.name = options.name;
        if (options.email) body.email = options.email;
        if (options.gender) body.gender = options.gender;

        const { confirmed } = await confirmUpdate(
          `/api/v1/attendees/${id}`,
          "attendee",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/attendees/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Attendee updated: ${id}`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update attendee");
        process.exit(1);
      }
    });

  attendees
    .command("delete <id>")
    .description("Delete an attendee")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/attendees/${id}`,
          "attendee",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/attendees/${id}`);
        outputSuccess(`Attendee deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete attendee");
        process.exit(1);
      }
    });

  attendees
    .command("check-in <code>")
    .description("Check in an attendee by code")
    .action(async (code: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/attendees/check-in/${code}`);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Attendee checked in successfully`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to check in attendee");
        process.exit(1);
      }
    });
}
