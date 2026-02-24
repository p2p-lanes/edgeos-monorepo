import { Command } from "commander";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { outputResult, outputError, outputSuccess, extractResults } from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

export function registerUsersCommands(program: Command): void {
  const usersCmd = program
    .command("users")
    .description("Manage admin users");

  // list
  usersCmd
    .command("list")
    .description("List users")
    .option("--search <query>", "Search query")
    .option("--role <role>", "Filter by role (superadmin/admin/viewer)")
    .option("--tenant <id>", "Filter by tenant ID")
    .option("--limit <n>", "Limit results", parseInt)
    .option("--skip <n>", "Skip results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet("/api/v1/users", {
          search: options.search,
          role: options.role,
          tenant_id: options.tenant,
          skip: options.skip,
          limit: options.limit,
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const rows = extractResults(data).map((u: any) => ({
            id: u.id,
            email: u.email,
            full_name: u.full_name,
            role: u.role,
            tenant_id: u.tenant_id,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list users");
        process.exit(1);
      }
    });

  // get
  usersCmd
    .command("get <id>")
    .description("Get user details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/users/${id}`);
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get user");
        process.exit(1);
      }
    });

  // create
  usersCmd
    .command("create")
    .description("Create a new user")
    .requiredOption("--email <email>", "Email address")
    .requiredOption(
      "--role <role>",
      "User role (superadmin/admin/viewer)"
    )
    .option("--full-name <name>", "Full name")
    .option("--tenant <id>", "Tenant ID")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          email: options.email,
          role: options.role,
        };
        if (options.fullName !== undefined) body.full_name = options.fullName;
        if (options.tenant !== undefined) body.tenant_id = options.tenant;

        const { confirmed } = await confirmCreate("user", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/users", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`User created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create user");
        process.exit(1);
      }
    });

  // update
  usersCmd
    .command("update <id>")
    .description("Update a user")
    .option("--email <email>", "Email address")
    .option("--full-name <name>", "Full name")
    .option("--role <role>", "User role (superadmin/admin/viewer)")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.email !== undefined) body.email = options.email;
        if (options.fullName !== undefined) body.full_name = options.fullName;
        if (options.role !== undefined) body.role = options.role;

        const { confirmed } = await confirmUpdate(
          `/api/v1/users/${id}`,
          "user",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/users/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`User updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update user");
        process.exit(1);
      }
    });

  // delete
  usersCmd
    .command("delete <id>")
    .description("Delete a user")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/users/${id}`,
          "user",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/users/${id}`);
        outputSuccess(`User deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete user");
        process.exit(1);
      }
    });
}
