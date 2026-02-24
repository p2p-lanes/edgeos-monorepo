import { Command } from "commander";
import { login, authenticate, getCurrentUser } from "../lib/auth.ts";
import {
  getConfig,
  setConfig,
  loadConfig,
  saveConfig,
} from "../lib/config.ts";
import { outputResult, outputError, outputSuccess } from "../lib/output.ts";

function prompt(message: string): Promise<string> {
  process.stdout.write(message);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk: string | Buffer) => {
      process.stdin.pause();
      resolve(chunk.toString().trim());
    });
  });
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Log in to EdgeOS with your email")
    .option("-e, --email <email>", "Email address")
    .option(
      "-c, --code <code>",
      "Authentication code (skip interactive prompt)"
    )
    .action(async (options) => {
      try {
        // Get email
        let email = options.email;
        if (!email) {
          email = await prompt("Email: ");
        }

        if (!email) {
          outputError("Email is required");
          process.exit(1);
        }

        let code = options.code;

        // Only request a new login code if --code was not provided
        if (!code) {
          const loginResult = await login(email);
          outputSuccess(
            loginResult.message ||
              `Verification code sent to ${email}. Code expires in ${loginResult.expires_in_minutes} minutes.`
          );
          code = await prompt("Enter verification code: ");
        }

        if (!code) {
          outputError("Verification code is required");
          process.exit(1);
        }

        // Authenticate
        const authResult = await authenticate(email, code);

        // Store token and email
        setConfig("token", authResult.access_token);
        setConfig("user_email", email);

        outputSuccess(`Successfully logged in as ${email}`);
      } catch (err: any) {
        outputError(err.message || "Login failed");
        process.exit(1);
      }
    });
}

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Log out from EdgeOS")
    .action(() => {
      try {
        const config = loadConfig();
        delete config.token;
        delete config.user_email;
        saveConfig(config);

        outputSuccess("Successfully logged out");
      } catch (err: any) {
        outputError(err.message || "Logout failed");
        process.exit(1);
      }
    });
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the current logged-in user")
    .action(async (_, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const user = await getCurrentUser();

        if (jsonOutput) {
          outputResult(user, { json: true });
        } else {
          outputResult(
            {
              email: user.email,
              role: user.role,
              tenant_id: user.tenant_id,
              id: user.id,
            },
            { json: false }
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to get user info");
        process.exit(1);
      }
    });
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current CLI status and configuration")
    .action(async (_, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const apiUrl = getConfig("api_url") || "http://localhost:8000";
        const token = getConfig("token");
        const tenantId = getConfig("tenant_id");
        const popupId = getConfig("popup_id");
        const email = getConfig("user_email");

        const status: Record<string, any> = {
          api_url: apiUrl,
          authenticated: !!token,
          email: email || "-",
          tenant_id: tenantId || "-",
          popup_id: popupId || "-",
        };

        outputResult(status, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get status");
        process.exit(1);
      }
    });
}

export function registerAuthCommands(program: Command): void {
  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerWhoamiCommand(program);
  registerStatusCommand(program);
}
