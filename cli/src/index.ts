#!/usr/bin/env bun

import { Command } from "commander";
import { setGlobalOptions } from "./lib/api.ts";
import { registerAuthCommands } from "./commands/login.ts";
import { registerConfigCommands } from "./commands/config.ts";
import { registerPopupCommands } from "./commands/popups.ts";
import { registerApplicationCommands } from "./commands/applications.ts";
import { registerReviewCommands } from "./commands/reviews.ts";
import { registerAttendeeCommands } from "./commands/attendees.ts";
import { registerDashboardCommand } from "./commands/dashboard.ts";
import { registerProductCommands } from "./commands/products.ts";
import { registerCouponCommands } from "./commands/coupons.ts";
import { registerPaymentCommands } from "./commands/payments.ts";
import { registerGroupsCommands } from "./commands/groups.ts";
import { registerHumansCommands } from "./commands/humans.ts";
import { registerUsersCommands } from "./commands/users.ts";
import { registerTenantsCommands } from "./commands/tenants.ts";
import { registerFormCommands } from "./commands/forms.ts";
import { registerTemplateCommands } from "./commands/templates.ts";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("edgeos")
  .description("EdgeOS CLI - Manage your EdgeOS platform from the terminal")
  .version(VERSION)
  .option("--json", "Output results as JSON")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--dry-run", "Show what would change without executing")
  .option("--api-url <url>", "Override API URL")
  .option("--tenant-id <id>", "Override tenant ID")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    setGlobalOptions({
      apiUrl: opts.apiUrl,
      tenantId: opts.tenantId,
    });
  });

// Register command groups
registerAuthCommands(program);
registerConfigCommands(program);
registerPopupCommands(program);
registerApplicationCommands(program);
registerReviewCommands(program);
registerAttendeeCommands(program);
registerDashboardCommand(program);
registerProductCommands(program);
registerCouponCommands(program);
registerPaymentCommands(program);
registerGroupsCommands(program);
registerHumansCommands(program);
registerUsersCommands(program);
registerTenantsCommands(program);
registerFormCommands(program);
registerTemplateCommands(program);

program.parse(process.argv);
