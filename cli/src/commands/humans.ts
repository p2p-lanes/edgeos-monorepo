import { Command } from "commander";
import { apiGet, apiPost, apiPatch } from "../lib/api.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  getConfirmOptions,
} from "../lib/confirm.ts";

export function registerHumansCommands(program: Command): void {
  const humansCmd = program
    .command("humans")
    .description("Manage humans (attendees/contacts)");

  // list
  humansCmd
    .command("list")
    .description("List humans")
    .option("--search <query>", "Search query")
    .option("--limit <n>", "Limit results", parseInt)
    .option("--skip <n>", "Skip results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet("/api/v1/humans", {
          search: options.search,
          skip: options.skip,
          limit: options.limit,
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const rows = extractResults(data).map((h: any) => ({
            id: h.id,
            email: h.email,
            first_name: h.first_name,
            last_name: h.last_name,
            organization: h.organization,
            role: h.role,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list humans");
        process.exit(1);
      }
    });

  // get
  humansCmd
    .command("get <id>")
    .description("Get human details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/humans/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get human");
        process.exit(1);
      }
    });

  // create
  humansCmd
    .command("create")
    .description("Create a new human")
    .requiredOption("--email <email>", "Email address")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--telegram <handle>", "Telegram handle")
    .option("--organization <org>", "Organization")
    .option("--role <role>", "Role")
    .option("--gender <gender>", "Gender")
    .option("--age <n>", "Age", parseInt)
    .option("--residence <residence>", "Residence")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          email: options.email,
        };
        if (options.firstName !== undefined) body.first_name = options.firstName;
        if (options.lastName !== undefined) body.last_name = options.lastName;
        if (options.telegram !== undefined) body.telegram = options.telegram;
        if (options.organization !== undefined)
          body.organization = options.organization;
        if (options.role !== undefined) body.role = options.role;
        if (options.gender !== undefined) body.gender = options.gender;
        if (options.age !== undefined) body.age = options.age;
        if (options.residence !== undefined) body.residence = options.residence;

        const { confirmed } = await confirmCreate("human", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/humans", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Human created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create human");
        process.exit(1);
      }
    });

  // update
  humansCmd
    .command("update <id>")
    .description("Update a human")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--telegram <handle>", "Telegram handle")
    .option("--organization <org>", "Organization")
    .option("--role <role>", "Role")
    .option("--gender <gender>", "Gender")
    .option("--age <n>", "Age", parseInt)
    .option("--residence <residence>", "Residence")
    .option("--picture-url <url>", "Picture URL")
    .option("--red-flag", "Mark as red flag")
    .option("--no-red-flag", "Remove red flag")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.firstName !== undefined) body.first_name = options.firstName;
        if (options.lastName !== undefined) body.last_name = options.lastName;
        if (options.telegram !== undefined) body.telegram = options.telegram;
        if (options.organization !== undefined)
          body.organization = options.organization;
        if (options.role !== undefined) body.role = options.role;
        if (options.gender !== undefined) body.gender = options.gender;
        if (options.age !== undefined) body.age = options.age;
        if (options.residence !== undefined) body.residence = options.residence;
        if (options.pictureUrl !== undefined)
          body.picture_url = options.pictureUrl;
        if (options.redFlag !== undefined) body.red_flag = options.redFlag;

        const { confirmed } = await confirmUpdate(
          `/api/v1/humans/${id}`,
          "human",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/humans/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Human updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update human");
        process.exit(1);
      }
    });
}
