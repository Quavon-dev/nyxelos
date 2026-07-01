import { describe, expect, it } from "bun:test";
import { skillRegistry } from "./skills-registry";
import { listSkillCatalog, resolveSkillDefinition } from "./skills-resolve";

describe("skills-resolve", () => {
	it("lists only runtime skills from the registry", async () => {
		const catalog = await listSkillCatalog();
		expect(catalog.map((entry) => entry.id).sort()).toEqual(
			skillRegistry.list()
				.map((skill) => skill.id)
				.sort(),
		);
		expect(new Set(catalog.map((entry) => entry.source))).toEqual(
			new Set(["builtin"]),
		);
	});

	it("resolves registry skills and rejects unknown ids", () => {
		expect(resolveSkillDefinition("workspace_file_list")).toBeTruthy();
		expect(resolveSkillDefinition("does_not_exist")).toBeNull();
	});
});
