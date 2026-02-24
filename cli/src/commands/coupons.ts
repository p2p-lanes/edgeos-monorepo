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

export function registerCouponCommands(program: Command): void {
  const couponsCmd = program
    .command("coupons")
    .description("Manage coupons");

  couponsCmd
    .command("list")
    .description("List coupons")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .option("--active <boolean>", "Filter by active status")
    .option("--search <query>", "Search coupons")
    .option("--limit <n>", "Limit results")
    .option("--skip <n>", "Skip results")
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
          is_active: options.active,
          search: options.search,
          limit: options.limit ? Number(options.limit) : undefined,
          skip: options.skip ? Number(options.skip) : undefined,
        };

        const coupons = await apiGet("/api/v1/coupons", params);

        if (jsonOutput) {
          outputResult(coupons, { json: true });
        } else {
          const rows = extractResults(coupons).map(
            (c: any) => ({
              id: c.id,
              code: c.code,
              discount: c.discount_value,
              max_uses: c.max_uses,
              current_uses: c.current_uses,
              active: c.is_active,
              popup_id: c.popup_id,
            })
          );
          process.stdout.write(
            formatTable(rows, [
              "id",
              "code",
              "discount",
              "max_uses",
              "current_uses",
              "active",
              "popup_id",
            ]) + "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list coupons");
        process.exit(1);
      }
    });

  couponsCmd
    .command("get <id>")
    .description("Get coupon details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const coupon = await apiGet(`/api/v1/coupons/${id}`);
        outputResult(coupon, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get coupon");
        process.exit(1);
      }
    });

  couponsCmd
    .command("create")
    .description("Create a new coupon")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .requiredOption("--code <code>", "Coupon code")
    .requiredOption("--discount <value>", "Discount value")
    .option("--max-uses <n>", "Max uses")
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .option("--active <boolean>", "Is active")
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
          code: options.code,
          discount_value: Number(options.discount),
        };

        if (options.maxUses !== undefined)
          body.max_uses = Number(options.maxUses);
        if (options.startDate !== undefined)
          body.start_date = options.startDate;
        if (options.endDate !== undefined) body.end_date = options.endDate;
        if (options.active !== undefined)
          body.is_active = options.active === "true";

        const { confirmed } = await confirmCreate("coupon", body, confirmOpts);
        if (!confirmed) return;

        const coupon = await apiPost("/api/v1/coupons", body);

        if (jsonOutput) {
          outputResult(coupon, { json: true });
        } else {
          outputSuccess(`Coupon created: ${coupon.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create coupon");
        process.exit(1);
      }
    });

  couponsCmd
    .command("update <id>")
    .description("Update a coupon")
    .option("--code <code>", "Coupon code")
    .option("--discount <value>", "Discount value")
    .option("--max-uses <n>", "Max uses")
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .option("--active <boolean>", "Is active")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};

        if (options.code !== undefined) body.code = options.code;
        if (options.discount !== undefined)
          body.discount_value = Number(options.discount);
        if (options.maxUses !== undefined)
          body.max_uses = Number(options.maxUses);
        if (options.startDate !== undefined)
          body.start_date = options.startDate;
        if (options.endDate !== undefined) body.end_date = options.endDate;
        if (options.active !== undefined)
          body.is_active = options.active === "true";

        const { confirmed } = await confirmUpdate(
          `/api/v1/coupons/${id}`,
          "coupon",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const coupon = await apiPatch(`/api/v1/coupons/${id}`, body);

        if (jsonOutput) {
          outputResult(coupon, { json: true });
        } else {
          outputSuccess(`Coupon updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update coupon");
        process.exit(1);
      }
    });

  couponsCmd
    .command("delete <id>")
    .description("Delete a coupon")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/coupons/${id}`,
          "coupon",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/coupons/${id}`);
        outputSuccess(`Coupon deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete coupon");
        process.exit(1);
      }
    });

  couponsCmd
    .command("validate <code>")
    .description("Validate a coupon code")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .action(async (code: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const result = await apiPost("/api/v1/coupons/validate", {
          popup_id: popupId,
          code,
        });

        if (jsonOutput) {
          outputResult(result, { json: true });
        } else {
          outputResult(result, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to validate coupon");
        process.exit(1);
      }
    });
}
