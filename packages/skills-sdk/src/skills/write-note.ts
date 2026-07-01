import { z } from "zod";
import { defineSkill } from "../define-skill";

/**
 * A factory rather than a fixed skill, for the same reason as web-fetch: the
 * allowed directory is a deployment-specific choice, not a sensible global
 * default. Marked `sensitive: true` on purpose — writing a file is a real
 * side effect — so it's the reference example for the approval workflow
 * (ADR-0009): every call goes through a pending approvalRequest instead of
 * writing immediately, until a human approves it.
 */
export function createWriteNoteSkill(allowedDir: string) {
  return defineSkill({
    id: "write_note",
    name: "Write a note",
    description:
      "Writes a text note to a file under a fixed, permission-scoped directory. Requires approval before it runs.",
    inputSchema: z.object({
      filename: z.string().describe('File name, e.g. "todo.md" — no path separators.'),
      content: z.string(),
    }),
    permissions: { network: [], filesystem: [allowedDir] },
    sensitive: true,
    async run({ filename, content }, ctx) {
      if (filename.includes("/") || filename.includes("\\")) {
        throw new Error("filename must not contain path separators.");
      }
      const path = `${allowedDir}/${filename}`;
      await ctx.writeFile(path, content);
      return { path, bytesWritten: content.length };
    },
  });
}
