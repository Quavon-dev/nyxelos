import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CHAT_WORKING_DIRECTORY = path.resolve(
	fileURLToPath(new URL("../../..", import.meta.url)),
);

export function normalizeChatWorkingDirectory(
	workingDirectory: string | null | undefined,
) {
	const trimmed = workingDirectory?.trim();
	if (!trimmed) return DEFAULT_CHAT_WORKING_DIRECTORY;
	return path.isAbsolute(trimmed)
		? path.resolve(trimmed)
		: path.resolve(DEFAULT_CHAT_WORKING_DIRECTORY, trimmed);
}
