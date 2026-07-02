import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isCustomCodeSkillsEnabled, isRemotePluginInstallEnabled } from "./feature-flags";

describe("feature flags", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_REMOTE_PLUGIN_INSTALL: process.env.ENABLE_REMOTE_PLUGIN_INSTALL,
    ENABLE_CUSTOM_CODE_SKILLS: process.env.ENABLE_CUSTOM_CODE_SKILLS,
  };

  beforeEach(() => {
    process.env.ENABLE_REMOTE_PLUGIN_INSTALL = undefined;
    process.env.ENABLE_CUSTOM_CODE_SKILLS = undefined;
  });

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    process.env.ENABLE_REMOTE_PLUGIN_INSTALL = original.ENABLE_REMOTE_PLUGIN_INSTALL;
    process.env.ENABLE_CUSTOM_CODE_SKILLS = original.ENABLE_CUSTOM_CODE_SKILLS;
  });

  test("remote plugin install defaults to disabled in production", () => {
    process.env.NODE_ENV = "production";
    expect(isRemotePluginInstallEnabled()).toBe(false);
  });

  test("remote plugin install defaults to enabled outside production", () => {
    process.env.NODE_ENV = "development";
    expect(isRemotePluginInstallEnabled()).toBe(true);
  });

  test("remote plugin install can be explicitly enabled in production", () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_REMOTE_PLUGIN_INSTALL = "true";
    expect(isRemotePluginInstallEnabled()).toBe(true);
  });

  test("custom-code skills default to disabled in production", () => {
    process.env.NODE_ENV = "production";
    expect(isCustomCodeSkillsEnabled()).toBe(false);
  });

  test("custom-code skills default to enabled outside production", () => {
    process.env.NODE_ENV = "development";
    expect(isCustomCodeSkillsEnabled()).toBe(true);
  });

  test("custom-code skills can be explicitly enabled in production", () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_CUSTOM_CODE_SKILLS = "true";
    expect(isCustomCodeSkillsEnabled()).toBe(true);
  });

  test("an explicit false in production stays disabled", () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_REMOTE_PLUGIN_INSTALL = "false";
    expect(isRemotePluginInstallEnabled()).toBe(false);
  });
});
