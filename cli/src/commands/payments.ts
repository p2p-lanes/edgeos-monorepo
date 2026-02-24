import { Command } from "commander";
import { apiGet, apiPost, apiPatch } from "../lib/api.ts";
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
  getConfirmOptions,
} from "../lib/confirm.ts";

function resolvePopupId(options: any): string | undefined {
  return options.popup || getConfig("popup_id");
}

export function registerPaymentCommands(program: Command): void {
  const paymentsCmd = program
    .command("payments")
    .description("Manage payments");

  paymentsCmd
    .command("list")
    .description("List payments")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .option("--application <id>", "Filter by application ID")
    .option(
      "--status <status>",
      "Filter by status (pending/approved/rejected/expired/cancelled)"
    )
    .option("--limit <n>", "Limit results")
    .option("--skip <n>", "Skip results")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: resolvePopupId(options),
          application_id: options.application,
          payment_status: options.status,
          limit: options.limit ? Number(options.limit) : undefined,
          skip: options.skip ? Number(options.skip) : undefined,
        };

        const payments = await apiGet("/api/v1/payments", params);

        if (jsonOutput) {
          outputResult(payments, { json: true });
        } else {
          const rows = extractResults(payments).map(
            (p: any) => ({
              id: p.id,
              status: p.status,
              amount: p.amount,
              currency: p.currency,
              application_id: p.application_id,
              created_at: p.created_at,
            })
          );
          process.stdout.write(
            formatTable(rows, [
              "id",
              "status",
              "amount",
              "currency",
              "application_id",
              "created_at",
            ]) + "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list payments");
        process.exit(1);
      }
    });

  paymentsCmd
    .command("get <id>")
    .description("Get payment details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const payment = await apiGet(`/api/v1/payments/${id}`);
        outputResult(payment, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get payment");
        process.exit(1);
      }
    });

  paymentsCmd
    .command("approve <id>")
    .description("Approve a payment")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmCreate("payment approval", { status: "approved" }, confirmOpts);
        if (!confirmed) return;

        const result = await apiPost(`/api/v1/payments/${id}/approve`);

        if (jsonOutput) {
          outputResult(result, { json: true });
        } else {
          outputSuccess(`Payment approved: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to approve payment");
        process.exit(1);
      }
    });

  paymentsCmd
    .command("update <id>")
    .description("Update a payment")
    .option(
      "--status <status>",
      "Payment status (pending/approved/rejected/expired/cancelled)"
    )
    .option("--external-id <id>", "External ID")
    .option("--source <source>", "Payment source (SimpleFI/Stripe)")
    .option("--rate <rate>", "Exchange rate")
    .option("--currency <currency>", "Currency")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};

        if (options.status !== undefined) body.status = options.status;
        if (options.externalId !== undefined)
          body.external_id = options.externalId;
        if (options.source !== undefined) body.source = options.source;
        if (options.rate !== undefined) body.rate = Number(options.rate);
        if (options.currency !== undefined) body.currency = options.currency;

        const { confirmed } = await confirmUpdate(
          `/api/v1/payments/${id}`,
          "payment",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const payment = await apiPatch(`/api/v1/payments/${id}`, body);

        if (jsonOutput) {
          outputResult(payment, { json: true });
        } else {
          outputSuccess(`Payment updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update payment");
        process.exit(1);
      }
    });
}
