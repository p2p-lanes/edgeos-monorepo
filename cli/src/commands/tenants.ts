import { Command } from "commander";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { setConfig } from "../lib/config.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

export function registerTenantsCommands(program: Command): void {
  const tenantsCmd = program
    .command("tenants")
    .description("Manage tenants (superadmin)");

  // list
  tenantsCmd
    .command("list")
    .description("List tenants")
    .option("--search <query>", "Search query")
    .option("--limit <n>", "Limit results", parseInt)
    .option("--skip <n>", "Skip results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet("/api/v1/tenants", {
          search: options.search,
          skip: options.skip,
          limit: options.limit,
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const rows = extractResults(data).map((t: any) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            sender_email: t.sender_email,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list tenants");
        process.exit(1);
      }
    });

  // get
  tenantsCmd
    .command("get <id>")
    .description("Get tenant details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/tenants/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get tenant");
        process.exit(1);
      }
    });

  // create
  tenantsCmd
    .command("create")
    .description("Create a new tenant")
    .requiredOption("--name <name>", "Tenant name")
    .option("--slug <slug>", "Tenant slug")
    .option("--sender-email <email>", "Sender email")
    .option("--sender-name <name>", "Sender name")
    .option("--image-url <url>", "Image URL")
    .option("--icon-url <url>", "Icon URL")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          name: options.name,
        };
        if (options.slug !== undefined) body.slug = options.slug;
        if (options.senderEmail !== undefined)
          body.sender_email = options.senderEmail;
        if (options.senderName !== undefined)
          body.sender_name = options.senderName;
        if (options.imageUrl !== undefined) body.image_url = options.imageUrl;
        if (options.iconUrl !== undefined) body.icon_url = options.iconUrl;

        const { confirmed } = await confirmCreate("tenant", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/tenants", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Tenant created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create tenant");
        process.exit(1);
      }
    });

  // update
  tenantsCmd
    .command("update <id>")
    .description("Update a tenant")
    .option("--name <name>", "Tenant name")
    .option("--slug <slug>", "Tenant slug")
    .option("--sender-email <email>", "Sender email")
    .option("--sender-name <name>", "Sender name")
    .option("--image-url <url>", "Image URL")
    .option("--icon-url <url>", "Icon URL")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.name !== undefined) body.name = options.name;
        if (options.slug !== undefined) body.slug = options.slug;
        if (options.senderEmail !== undefined)
          body.sender_email = options.senderEmail;
        if (options.senderName !== undefined)
          body.sender_name = options.senderName;
        if (options.imageUrl !== undefined) body.image_url = options.imageUrl;
        if (options.iconUrl !== undefined) body.icon_url = options.iconUrl;

        const { confirmed } = await confirmUpdate(
          `/api/v1/tenants/${id}`,
          "tenant",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/tenants/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Tenant updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update tenant");
        process.exit(1);
      }
    });

  // delete
  tenantsCmd
    .command("delete <id>")
    .description("Delete a tenant")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/tenants/${id}`,
          "tenant",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/tenants/${id}`);
        outputSuccess(`Tenant deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete tenant");
        process.exit(1);
      }
    });

  // use
  tenantsCmd
    .command("use <id>")
    .description("Set active tenant in CLI config")
    .action(async (id: string) => {
      try {
        const data = await apiGet(`/api/v1/tenants/${id}`);
        setConfig("tenant_id", id);
        outputSuccess(
          `Active tenant set to: ${data.name || id} (${id})`
        );
      } catch (err: any) {
        outputError(err.message || "Failed to set tenant");
        process.exit(1);
      }
    });
}
