import { describe, expect, it } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	fileURLToPath(new URL("../../../", import.meta.url)),
);
const serverRoot = fileURLToPath(new URL("../", import.meta.url));

describe("skillRegistry workspace sandbox", () => {
	it("defaults workspace file skills to the repo root instead of apps/server cwd", async () => {
		const previousCwd = process.cwd();
		const previousWorkspaceRoot = process.env.NYXEL_WORKSPACE_ROOT;
		delete process.env.NYXEL_WORKSPACE_ROOT;
		process.chdir(serverRoot);

		try {
			const { skillRegistry } = await import(
				`./skills-registry.ts?case=${Date.now()}`
			);
			const skill = skillRegistry.get("workspace_file_list");
			expect(skill?.permissions.filesystem).toEqual([repoRoot]);
		} finally {
			if (previousWorkspaceRoot === undefined) {
				delete process.env.NYXEL_WORKSPACE_ROOT;
			} else {
				process.env.NYXEL_WORKSPACE_ROOT = previousWorkspaceRoot;
			}
			process.chdir(previousCwd);
		}
	});
});
