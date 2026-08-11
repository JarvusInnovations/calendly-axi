import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearConfig,
  configDir,
  configPath,
  defaultConfig,
  isConfigured,
  readConfig,
  resolveCredentials,
  writeConfig,
} from "../src/config.js";

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
  delete process.env.CALENDLY_ACCESS_TOKEN;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_ACCESS_TOKEN;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
});

describe("config paths", () => {
  it("nests under $XDG_CONFIG_HOME/calendly-axi", () => {
    expect(configDir()).toBe(join(process.env.XDG_CONFIG_HOME!, "calendly-axi"));
    expect(configPath()).toBe(join(process.env.XDG_CONFIG_HOME!, "calendly-axi", "config.json"));
  });
});

describe("readConfig / writeConfig", () => {
  it("returns the default config when nothing is written yet", () => {
    expect(readConfig()).toEqual(defaultConfig());
  });

  it("round-trips a written config", () => {
    writeConfig({ version: 1, token: "pat_abc" });
    expect(readConfig()).toMatchObject({ version: 1, token: "pat_abc" });
  });

  it("writes config.json at mode 0600 inside a 0700 directory", () => {
    writeConfig({ version: 1, token: "pat_abc" });
    const dirMode = statSync(configDir()).mode & 0o777;
    const fileMode = statSync(configPath()).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("falls back to defaults on unparseable JSON, never throws", () => {
    writeConfig({ version: 1, token: "pat_abc" });
    // Corrupt the file directly.
    writeFileSync(configPath(), "{ not json", "utf-8");
    expect(() => readConfig()).not.toThrow();
    expect(readConfig()).toEqual(defaultConfig());
  });

  it("clearConfig removes the file and is a no-op when already absent", () => {
    writeConfig({ version: 1, token: "pat_abc" });
    expect(existsSync(configPath())).toBe(true);
    clearConfig();
    expect(existsSync(configPath())).toBe(false);
    expect(() => clearConfig()).not.toThrow();
  });
});

describe("resolveCredentials", () => {
  it("returns null when neither env nor config has a token", () => {
    expect(resolveCredentials()).toBeNull();
    expect(isConfigured()).toBe(false);
  });

  it("resolves from config with source 'config'", () => {
    writeConfig({ version: 1, token: "pat_from_config" });
    expect(resolveCredentials()).toEqual({ token: "pat_from_config", source: "config" });
  });

  it("prefers CALENDLY_ACCESS_TOKEN over the config file", () => {
    writeConfig({ version: 1, token: "pat_from_config" });
    process.env.CALENDLY_ACCESS_TOKEN = "pat_from_env";
    expect(resolveCredentials()).toEqual({ token: "pat_from_env", source: "env" });
  });

  it("round file content matches the ProfileCache shape", () => {
    writeConfig({
      version: 1,
      token: "pat_abc",
      profile_cache: {
        user_uri: "https://api.calendly.com/users/ABC",
        user_uuid: "ABC",
        name: "Chris Alfano",
        email: "chris@jarv.us",
        scheduling_url: "https://calendly.com/chris",
        timezone: "America/New_York",
        organization_uri: "https://api.calendly.com/organizations/ORG",
        organization_uuid: "ORG",
        cached_at: new Date().toISOString(),
      },
    });
    const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(onDisk.profile_cache.name).toBe("Chris Alfano");
  });
});
