import { Command } from "commander";
import { apiGet } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import { outputResult, outputError, extractResults } from "../lib/output.ts";

export function registerReviewCommands(program: Command): void {
  const reviews = program
    .command("reviews")
    .description("Manage application reviews");

  reviews
    .command("pending")
    .description("List applications pending review")
    .option("-p, --popup <id>", "Popup ID (or from context)")
    .option("-l, --limit <number>", "Limit number of results", parseInt)
    .option("--skip <number>", "Skip number of results", parseInt)
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = options.popup || getConfig("popup_id");
        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: popupId,
          limit: options.limit,
          skip: options.skip,
        };
        const data = await apiGet("/api/v1/applications/pending-review", params);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((a: any) => ({
            id: a.id,
            status: a.status,
            human_email: a.human?.email,
            popup_id: a.popup_id,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list pending reviews");
        process.exit(1);
      }
    });

  reviews
    .command("list <application-id>")
    .description("List reviews for an application")
    .action(async (applicationId: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(`/api/v1/applications/${applicationId}/reviews`);

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((r: any) => ({
            id: r.id,
            reviewer: r.reviewer?.email || r.reviewer_id || r.reviewer,
            decision: r.decision,
            notes: r.notes,
            created_at: r.created_at,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list reviews");
        process.exit(1);
      }
    });

  reviews
    .command("summary <application-id>")
    .description("Get review summary for an application")
    .action(async (applicationId: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet(
          `/api/v1/applications/${applicationId}/reviews/summary`
        );
        outputResult(data, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get review summary");
        process.exit(1);
      }
    });

  reviews
    .command("mine")
    .description("List my reviews")
    .action(async (_, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const data = await apiGet("/api/v1/applications/my-reviews");

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          const items = extractResults(data);
          const rows = items.map((r: any) => ({
            id: r.id,
            application_id: r.application_id,
            decision: r.decision,
            notes: r.notes,
            created_at: r.created_at,
          }));
          outputResult(rows, { json: false });
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list my reviews");
        process.exit(1);
      }
    });
}
