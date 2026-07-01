import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { createSkillContext } from "@nyxel/skills-sdk";
import { createWorkspaceFilePatchSkill } from "@nyxel/skills-sdk";

describe("workspace_file_patch", () => {
	it("applies ordered patch operations and returns a diff preview", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "nyxel-patch-"));
		const filePath = path.join(root, "sample.ts");
		await writeFile(filePath, "const value = 1;\nconsole.log(value);\n", "utf8");

		const skill = createWorkspaceFilePatchSkill(root);
		const output = await skill.run(
			{
				path: "sample.ts",
				createIfMissing: false,
				operations: [
					{
						type: "search_replace",
						search: "const value = 1;",
						replace: "const value = 2;",
					},
					{
						type: "insert_after",
						anchor: "console.log(value);",
						content: "\nexport { value };",
					},
				],
			},
			createSkillContext(skill.permissions),
		);

		const updated = await readFile(filePath, "utf8");
		expect(updated).toContain("const value = 2;");
		expect(updated).toContain("export { value };");
		expect(output.diffPreview).toContain("+++ after");
	});

	it("rejects ambiguous search operations unless matchIndex is provided", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "nyxel-patch-"));
		const filePath = path.join(root, "sample.ts");
		await writeFile(filePath, "hello\nhello\n", "utf8");

		const skill = createWorkspaceFilePatchSkill(root);

		await expect(
			skill.run(
				{
					path: "sample.ts",
					createIfMissing: false,
					operations: [
						{
							type: "search_replace",
							search: "hello",
							replace: "hi",
						},
					],
				},
				createSkillContext(skill.permissions),
			),
		).rejects.toThrow("ambiguous");
	});
});
