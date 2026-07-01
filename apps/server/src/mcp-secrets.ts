import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Secrets a stdio MCP server's own env vars point to (e.g. an OAuth
// credentials file) live outside the repo, under the user's home directory —
// same convention as other local CLI tool config (~/.aws, ~/.config/gh).
const SECRETS_DIR = join(homedir(), ".nyxel", "mcp-secrets");

/** Writes a connector secret to a workspace-scoped file and returns its
 * absolute path, for use as an env var value (e.g. GOOGLE_OAUTH_CREDENTIALS). */
export function writeMcpSecretFile(
	workspaceId: string,
	fileKey: string,
	contents: string,
): string {
	const dir = join(SECRETS_DIR, workspaceId);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, `${fileKey}.json`);
	writeFileSync(path, contents, { mode: 0o600 });
	return path;
}
