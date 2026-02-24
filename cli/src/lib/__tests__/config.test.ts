import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadConfig,
  saveConfig,
  getConfig,
  setConfig,
  clearConfig,
  getConfigDir,
  getConfigPath,
} from "../config.ts";

let tempDir: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "edgeos-test-"));
  originalEnv = {
    EDGEOS_CONFIG_DIR: process.env.EDGEOS_CONFIG_DIR,
    EDGEOS_API_URL: process.env.EDGEOS_API_URL,
    EDGEOS_TOKEN: process.env.EDGEOS_TOKEN,
    EDGEOS_TENANT_ID: process.env.EDGEOS_TENANT_ID,
    EDGEOS_POPUP_ID: process.env.EDGEOS_POPUP_ID,
  };
  process.env.EDGEOS_CONFIG_DIR = tempDir;
  // Clear env overrides
  delete process.env.EDGEOS_API_URL;
  delete process.env.EDGEOS_TOKEN;
  delete process.env.EDGEOS_TENANT_ID;
  delete process.env.EDGEOS_POPUP_ID;
});

afterEach(() => {
  // Restore env
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Clean up temp dir
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true });
  }
});

describe("config", () => {
  describe("getConfigDir", () => {
    it("returns EDGEOS_CONFIG_DIR when set", () => {
      expect(getConfigDir()).toBe(tempDir);
    });
  });

  describe("getConfigPath", () => {
    it("returns config.json path inside config dir", () => {
      expect(getConfigPath()).toBe(join(tempDir, "config.json"));
    });
  });

  describe("loadConfig", () => {
    it("returns empty object when no config file exists", () => {
      const config = loadConfig();
      expect(config).toEqual({});
    });

    it("returns parsed config when file exists", () => {
      saveConfig({ api_url: "http://test:8000", token: "abc123" });
      const config = loadConfig();
      expect(config.api_url).toBe("http://test:8000");
      expect(config.token).toBe("abc123");
    });
  });

  describe("saveConfig + loadConfig roundtrip", () => {
    it("persists all config fields", () => {
      const original = {
        api_url: "http://example.com",
        token: "my-token",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        user_email: "user@example.com",
      };
      saveConfig(original);
      const loaded = loadConfig();
      expect(loaded).toEqual(original);
    });
  });

  describe("getConfig with env var overrides", () => {
    it("returns env var value when set for api_url", () => {
      saveConfig({ api_url: "http://file-value:8000" });
      process.env.EDGEOS_API_URL = "http://env-value:8000";
      expect(getConfig("api_url")).toBe("http://env-value:8000");
    });

    it("returns env var value when set for token", () => {
      saveConfig({ token: "file-token" });
      process.env.EDGEOS_TOKEN = "env-token";
      expect(getConfig("token")).toBe("env-token");
    });

    it("returns env var value when set for tenant_id", () => {
      process.env.EDGEOS_TENANT_ID = "env-tenant";
      expect(getConfig("tenant_id")).toBe("env-tenant");
    });

    it("returns env var value when set for popup_id", () => {
      process.env.EDGEOS_POPUP_ID = "env-popup";
      expect(getConfig("popup_id")).toBe("env-popup");
    });

    it("returns file value when env var not set", () => {
      saveConfig({ api_url: "http://file-value:8000" });
      expect(getConfig("api_url")).toBe("http://file-value:8000");
    });

    it("returns undefined when neither env nor file has value", () => {
      expect(getConfig("api_url")).toBeUndefined();
    });

    it("returns file value for user_email (no env override)", () => {
      saveConfig({ user_email: "test@test.com" });
      expect(getConfig("user_email")).toBe("test@test.com");
    });
  });

  describe("setConfig", () => {
    it("sets a single config key", () => {
      setConfig("api_url", "http://new:8000");
      expect(getConfig("api_url")).toBe("http://new:8000");
    });

    it("preserves existing keys when setting a new one", () => {
      setConfig("api_url", "http://test:8000");
      setConfig("token", "my-token");
      expect(getConfig("api_url")).toBe("http://test:8000");
      expect(getConfig("token")).toBe("my-token");
    });
  });

  describe("clearConfig", () => {
    it("deletes the config file", () => {
      saveConfig({ token: "abc" });
      expect(existsSync(getConfigPath())).toBe(true);
      clearConfig();
      expect(existsSync(getConfigPath())).toBe(false);
    });

    it("does not throw when no config file exists", () => {
      expect(() => clearConfig()).not.toThrow();
    });
  });
});
