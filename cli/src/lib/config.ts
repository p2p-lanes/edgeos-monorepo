import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface EdgeosConfig {
  api_url?: string;
  token?: string;
  tenant_id?: string;
  popup_id?: string;
  user_email?: string;
}

const ENV_MAP: Record<string, keyof EdgeosConfig> = {
  EDGEOS_API_URL: "api_url",
  EDGEOS_TOKEN: "token",
  EDGEOS_TENANT_ID: "tenant_id",
  EDGEOS_POPUP_ID: "popup_id",
};

export function getConfigDir(): string {
  const envDir = process.env.EDGEOS_CONFIG_DIR;
  if (envDir) {
    return envDir;
  }
  return join(homedir(), ".edgeos");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(): EdgeosConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as EdgeosConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: EdgeosConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function getConfig(key: keyof EdgeosConfig): string | undefined {
  // Check env var overrides first
  for (const [envVar, configKey] of Object.entries(ENV_MAP)) {
    if (configKey === key) {
      const envValue = process.env[envVar];
      if (envValue !== undefined && envValue !== "") {
        return envValue;
      }
    }
  }
  // Fall back to config file
  const config = loadConfig();
  return config[key];
}

export function setConfig(key: keyof EdgeosConfig, value: string): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function clearConfig(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
}
