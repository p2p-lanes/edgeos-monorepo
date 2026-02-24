import { Command } from "commander";
import {
  getConfig,
  setConfig,
  loadConfig,
  type EdgeosConfig,
} from "../lib/config.ts";
import { outputResult, outputError, outputSuccess } from "../lib/output.ts";

const VALID_KEYS: (keyof EdgeosConfig)[] = [
  "api_url",
  "token",
  "tenant_id",
  "popup_id",
  "user_email",
];

function isValidKey(key: string): key is keyof EdgeosConfig {
  return VALID_KEYS.includes(key as keyof EdgeosConfig);
}

function maskToken(value: string): string {
  if (value.length <= 8) {
    return "****";
  }
  return value.slice(0, 4) + "..." + value.slice(-4);
}

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage CLI configuration");

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      if (!isValidKey(key)) {
        outputError(
          `Invalid config key: ${key}. Valid keys: ${VALID_KEYS.join(", ")}`
        );
        process.exit(1);
      }
      setConfig(key, value);
      outputSuccess(`Set ${key} = ${key === "token" ? maskToken(value) : value}`);
    });

  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action((key: string) => {
      if (!isValidKey(key)) {
        outputError(
          `Invalid config key: ${key}. Valid keys: ${VALID_KEYS.join(", ")}`
        );
        process.exit(1);
      }
      const value = getConfig(key);
      if (value === undefined) {
        outputSuccess(`${key}: (not set)`);
      } else {
        const display = key === "token" ? maskToken(value) : value;
        outputSuccess(`${key}: ${display}`);
      }
    });

  configCmd
    .command("list")
    .description("List all configuration values")
    .action((_, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const config = loadConfig();

      if (jsonOutput) {
        // Mask token in JSON output too
        const masked = { ...config };
        if (masked.token) {
          masked.token = maskToken(masked.token);
        }
        outputResult(masked, { json: true });
      } else {
        const entries: Record<string, string> = {};
        for (const key of VALID_KEYS) {
          const value = config[key];
          if (value !== undefined) {
            entries[key] = key === "token" ? maskToken(value) : value;
          } else {
            entries[key] = "(not set)";
          }
        }
        outputResult(entries, { json: false });
      }
    });
}
