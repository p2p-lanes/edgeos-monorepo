import { Command } from "commander";
import { readFileSync } from "fs";
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

export function registerGroupsCommands(program: Command): void {
  const groupsCmd = program
    .command("groups")
    .description("Manage groups");

  // list
  groupsCmd
    .command("list")
    .description("List groups")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .option("--search <query>", "Search query")
    .option("--limit <n>", "Limit results", parseInt)
    .option("--skip <n>", "Skip results", parseInt)
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

        const data = await apiGet("/api/v1/groups", {
          popup_id: popupId,
          search: options.search,
          skip: options.skip,
          limit: options.limit,
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const rows = extractResults(data).map((g: any) => ({
            id: g.id,
            name: g.name,
            slug: g.slug,
            discount: g.discount_percentage,
            max_members: g.max_members,
            ambassador: g.is_ambassador_group ? "Yes" : "No",
            popup_id: g.popup_id,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list groups");
        process.exit(1);
      }
    });

  // get
  groupsCmd
    .command("get <id>")
    .description("Get group details with members")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/groups/${id}`);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const { members, ...groupInfo } = data;
          outputResult(groupInfo, { json: false });

          if (members && members.length > 0) {
            process.stdout.write("\nMembers:\n");
            const memberRows = members.map((m: any) => ({
              id: m.id,
              name: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
              email: m.email,
              role: m.role,
              organization: m.organization,
            }));
            process.stdout.write(formatTable(memberRows) + "\n");
          } else {
            process.stdout.write("\nNo members found.\n");
          }
        }
      } catch (err: any) {
        outputError(err.message || "Failed to get group");
        process.exit(1);
      }
    });

  // create
  groupsCmd
    .command("create")
    .description("Create a new group")
    .requiredOption("--name <name>", "Group name")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .option("--slug <slug>", "Group slug")
    .option("--description <text>", "Group description")
    .option("--discount <n>", "Discount percentage", parseFloat)
    .option("--max-members <n>", "Max members", parseInt)
    .option("--welcome-message <text>", "Welcome message")
    .option("--ambassador", "Is ambassador group", false)
    .option("--ambassador-id <id>", "Ambassador ID")
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
        };
        if (options.slug !== undefined) body.slug = options.slug;
        if (options.description !== undefined)
          body.description = options.description;
        if (options.discount !== undefined)
          body.discount_percentage = options.discount;
        if (options.maxMembers !== undefined)
          body.max_members = options.maxMembers;
        if (options.welcomeMessage !== undefined)
          body.welcome_message = options.welcomeMessage;
        if (options.ambassador) body.is_ambassador_group = true;
        if (options.ambassadorId !== undefined)
          body.ambassador_id = options.ambassadorId;

        const { confirmed } = await confirmCreate("group", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost("/api/v1/groups", body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Group created: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create group");
        process.exit(1);
      }
    });

  // update
  groupsCmd
    .command("update <id>")
    .description("Update a group")
    .option("--name <name>", "Group name")
    .option("--slug <slug>", "Group slug")
    .option("--description <text>", "Group description")
    .option("--discount <n>", "Discount percentage", parseFloat)
    .option("--max-members <n>", "Max members", parseInt)
    .option("--welcome-message <text>", "Welcome message")
    .option("--ambassador", "Is ambassador group")
    .option("--ambassador-id <id>", "Ambassador ID")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};
        if (options.name !== undefined) body.name = options.name;
        if (options.slug !== undefined) body.slug = options.slug;
        if (options.description !== undefined)
          body.description = options.description;
        if (options.discount !== undefined)
          body.discount_percentage = options.discount;
        if (options.maxMembers !== undefined)
          body.max_members = options.maxMembers;
        if (options.welcomeMessage !== undefined)
          body.welcome_message = options.welcomeMessage;
        if (options.ambassador !== undefined)
          body.is_ambassador_group = options.ambassador;
        if (options.ambassadorId !== undefined)
          body.ambassador_id = options.ambassadorId;

        const { confirmed } = await confirmUpdate(
          `/api/v1/groups/${id}`,
          "group",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const data = await apiPatch(`/api/v1/groups/${id}`, body);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Group updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update group");
        process.exit(1);
      }
    });

  // delete
  groupsCmd
    .command("delete <id>")
    .description("Delete a group")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/groups/${id}`,
          "group",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/groups/${id}`);
        outputSuccess(`Group deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete group");
        process.exit(1);
      }
    });

  // add-member
  groupsCmd
    .command("add-member <group-id>")
    .description("Add a member to a group")
    .requiredOption("--email <email>", "Member email")
    .requiredOption("--first-name <name>", "First name")
    .requiredOption("--last-name <name>", "Last name")
    .option("--telegram <handle>", "Telegram handle")
    .option("--organization <org>", "Organization")
    .option("--role <role>", "Role")
    .option("--gender <gender>", "Gender")
    .action(async (groupId: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {
          first_name: options.firstName,
          last_name: options.lastName,
          email: options.email,
        };
        if (options.telegram !== undefined) body.telegram = options.telegram;
        if (options.organization !== undefined)
          body.organization = options.organization;
        if (options.role !== undefined) body.role = options.role;
        if (options.gender !== undefined) body.gender = options.gender;

        const { confirmed } = await confirmCreate("group member", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost(
          `/api/v1/groups/my/${groupId}/members`,
          body
        );

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(`Member added to group ${groupId}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to add member");
        process.exit(1);
      }
    });

  // remove-member
  groupsCmd
    .command("remove-member <group-id> <human-id>")
    .description("Remove a member from a group")
    .action(async (groupId: string, humanId: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/groups/my/${groupId}/members/${humanId}`,
          "group member",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(
          `/api/v1/groups/my/${groupId}/members/${humanId}`
        );
        outputSuccess(
          `Member ${humanId} removed from group ${groupId}`
        );
      } catch (err: any) {
        outputError(err.message || "Failed to remove member");
        process.exit(1);
      }
    });

  // import-members
  groupsCmd
    .command("import-members <group-id> <file>")
    .description("Batch import members from a JSON file")
    .option("--update-existing", "Update existing members", false)
    .action(async (groupId: string, file: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const raw = readFileSync(file, "utf-8");
        const members = JSON.parse(raw);

        if (!Array.isArray(members)) {
          outputError("File must contain a JSON array of members");
          process.exit(1);
        }

        const body: Record<string, any> = {
          members,
          update_existing: options.updateExisting || false,
        };

        const { confirmed } = await confirmCreate("member import", body, confirmOpts);
        if (!confirmed) return;

        const data = await apiPost(
          `/api/v1/groups/my/${groupId}/members/batch`,
          body
        );

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          outputSuccess(
            `Imported ${members.length} members to group ${groupId}`
          );
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          outputError(`File not found: ${file}`);
        } else {
          outputError(err.message || "Failed to import members");
        }
        process.exit(1);
      }
    });
}
