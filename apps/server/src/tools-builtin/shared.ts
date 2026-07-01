import path from "node:path";
import type { ToolRecord } from "@nyxel/db";

/** Every tools-builtin/* module builds one SkillDefinition-shaped object per
 * ToolRecord, keyed by the record's own id/name/description/sensitive (not
 * whatever a reused skills-sdk factory would otherwise pick) — see
 * tools-dynamic.ts's `base` object for the convention this mirrors. */
export function baseFields(record: ToolRecord) {
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		sensitive: record.sensitive,
	};
}

export function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

export function allowedDirsFromConfig(config: Record<string, unknown>) {
	return stringArray(config.allowedDirs).map((dir) => path.resolve(dir));
}

export function allowedHostsFromConfig(config: Record<string, unknown>) {
	return stringArray(config.allowedHosts);
}
