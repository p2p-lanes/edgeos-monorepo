import { Command } from "commander";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { getConfig, setConfig } from "../lib/config.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

export function registerPopupCommands(program: Command): void {
  const popups = program
    .command("popups")
    .description("Manage popups");

  popups
    .command("list")
    .description("List all popups")
    .option("-s, --search <query>", "Search popups by name")
    .option("-l, --limit <number>", "Limit number of results", parseInt)
    .option("--skip <number>", "Skip number of results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          search: options.search,
          limit: options.limit,
          skip: options.skip,
        };
        const data = await apiGet("/api/v1/popups", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const rows = extractResults(data).map((p: any) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            status: p.status,
            start_date: p.start_date,
            end_date: p.end_date,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list popups");
        process.exit(1);
      }
    });

  popups
    .command("get <id>")
    .description("Get popup details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/popups/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get popup");
        process.exit(1);
      }
    });

  popups
    .command("create")
    .description("Create a new popup")
    .requiredOption("-n, --name <name>", "Popup name")
    .option("--slug <slug>", "Popup slug")
    .option("--status <status>", "Popup status (draft/active/archived/ended)")
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          name: options.name,
        };
        if (options.slug) body.slug = options.slug;
        if (options.status) body.status = options.status;
        if (options.startDate) body.start_date = options.startDate;
        if (options.endDate) body.end_date = options.endDate;

        const { confirmed } = await confirmCreate("popup", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/popups", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Popup created: ${data.id}`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create popup");
        process.exit(1);
      }
    });

  popups
    .command("update <id>")
    .description("Update a popup")
    .option("-n, --name <name>", "Popup name")
    .option("--slug <slug>", "Popup slug")
    .option("--status <status>", "Popup status (draft/active/archived/ended)")
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.name) body.name = options.name;
        if (options.slug) body.slug = options.slug;
        if (options.status) body.status = options.status;
        if (options.startDate) body.start_date = options.startDate;
        if (options.endDate) body.end_date = options.endDate;

        const { confirmed } = await confirmUpdate(
          `/api/v1/popups/${id}`,
          "popup",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/popups/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Popup updated: ${id}`);
          outputResult(data, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update popup");
        process.exit(1);
      }
    });

  popups
    .command("delete <id>")
    .description("Delete a popup")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/popups/${id}`,
          "popup",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/popups/${id}`);
        outputSuccess(`Popup deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete popup");
        process.exit(1);
      }
    });

  popups
    .command("use <id>")
    .description("Set a popup as the active context")
    .action(async (id: string) => {
      try {
        const popup = await apiGet(`/api/v1/popups/${id}`);
        setConfig("popup_id", id);
        outputSuccess(`Now using popup: ${popup.name} (${id})`);
      } catch (err: any) {
        outputError(err.message || "Failed to set popup context");
        process.exit(1);
      }
    });
}
