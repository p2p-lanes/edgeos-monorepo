import { Command } from "commander";
import { apiGet } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import { outputResult, outputError, outputSuccess } from "../lib/output.ts";

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Show dashboard stats for a popup")
    .option("-p, --popup <id>", "Popup ID (required, or from context)")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = options.popup || getConfig("popup_id");
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set with `edgeos popups use <id>`"
          );
          process.exit(1);
        }

        const data = await apiGet("/api/v1/dashboard/stats", {
          popup_id: popupId,
        });

        if (jsonOutput) {
          outputResult(data, { json: true });
        } else {
          // Format stats in a readable way
          const lines: string[] = [];

          if (data.applications) {
            lines.push("=== Applications ===");
            lines.push(`  Total:     ${data.applications.total ?? "-"}`);
            lines.push(`  Draft:     ${data.applications.draft ?? "-"}`);
            lines.push(`  In Review: ${data.applications.in_review ?? "-"}`);
            lines.push(`  Accepted:  ${data.applications.accepted ?? "-"}`);
            lines.push(`  Rejected:  ${data.applications.rejected ?? "-"}`);
            lines.push(`  Withdrawn: ${data.applications.withdrawn ?? "-"}`);
          }

          if (data.attendees) {
            lines.push("");
            lines.push("=== Attendees ===");
            lines.push(`  Total:  ${data.attendees.total ?? "-"}`);
            lines.push(`  Main:   ${data.attendees.main ?? "-"}`);
            lines.push(`  Spouse: ${data.attendees.spouse ?? "-"}`);
            lines.push(`  Kid:    ${data.attendees.kid ?? "-"}`);
          }

          if (data.payments) {
            lines.push("");
            lines.push("=== Payments ===");
            lines.push(`  Total:         ${data.payments.total ?? "-"}`);
            lines.push(`  Pending:       ${data.payments.pending ?? "-"}`);
            lines.push(`  Approved:      ${data.payments.approved ?? "-"}`);
            lines.push(`  Rejected:      ${data.payments.rejected ?? "-"}`);
            lines.push(`  Total Revenue: ${data.payments.total_revenue ?? "-"}`);
          }

          for (const line of lines) {
            outputSuccess(line);
          }
        }
      } catch (err: any) {
        outputError(err.message || "Failed to get dashboard stats");
        process.exit(1);
      }
    });
}
