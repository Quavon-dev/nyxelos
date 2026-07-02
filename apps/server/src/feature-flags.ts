function readFlag(envVar: string, defaultEnabled: boolean): boolean {
  const raw = process.env[envVar];
  if (raw === undefined) return defaultEnabled;
  return raw.toLowerCase() === "true" || raw === "1";
}

// Read fresh on every call rather than cached at module-load time — unlike
// auth.ts/crypto.ts's secret guards (which only ever need to check once at
// boot and are fine throwing early), these flags gate a per-call code path
// and must reflect the actual environment at call time, not import time.
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * `installPluginFromGithub` (plugins.ts) downloads and registers arbitrary
 * third-party code as directly-runnable skills, with no signing/vetting
 * (SECURITY_AUDIT.md SEC-08, PLUGIN_SECURITY.md). Disabled by default in
 * production; still on by default in dev so the feature stays usable while
 * developing. Set ENABLE_REMOTE_PLUGIN_INSTALL=true to opt in explicitly.
 */
export function isRemotePluginInstallEnabled(): boolean {
  return readFlag("ENABLE_REMOTE_PLUGIN_INSTALL", !isProduction());
}

/**
 * `custom_code` tools run a user-supplied string via `new Function(...)` in
 * the main server process (tools-dynamic.ts) — not sandboxed beyond the
 * scoped fetch/fs context also handed to every other skill (ADR-0007).
 * Disabled by default in production for the same reason as plugin installs
 * above. Set ENABLE_CUSTOM_CODE_SKILLS=true to opt in explicitly.
 */
export function isCustomCodeSkillsEnabled(): boolean {
  return readFlag("ENABLE_CUSTOM_CODE_SKILLS", !isProduction());
}
