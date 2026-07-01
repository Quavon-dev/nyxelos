import { describe, expect, it } from "bun:test";
import { skillRegistry } from "./skills-registry";
import { listSkillCatalog, resolveSkillDefinition } from "./skills-resolve";

const TEST_WORKSPACE_ID = "test-workspace-skills-resolve";

describe("skills-resolve", () => {
	it("lists registry skills for a workspace with no file skills yet", async () => {
		const catalog = await listSkillCatalog(TEST_WORKSPACE_ID);
		const builtinEntries = catalog.filter((entry) => entry.source === "builtin");
		expect(builtinEntries.map((entry) => entry.id).sort()).toEqual(
			skillRegistry.list()
				.map((skill) => skill.id)
				.sort(),
		);
	});

	it("resolves registry skills and rejects unknown ids", async () => {
		expect(await resolveSkillDefinition(TEST_WORKSPACE_ID, "workspace_file_list")).toBeTruthy();
		expect(await resolveSkillDefinition(TEST_WORKSPACE_ID, "does_not_exist")).toBeNull();
	});
});
