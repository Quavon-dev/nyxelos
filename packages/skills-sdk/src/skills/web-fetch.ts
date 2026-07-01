import { z } from "zod";
import { defineSkill } from "../define-skill";

/**
 * A factory rather than a fixed skill, because the whole point is that the
 * allowed hosts are declared explicitly by whoever registers it — there is
 * no sensible global default for "which websites can this agent fetch".
 */
export function createWebFetchSkill(allowedHosts: string[]) {
  return defineSkill({
    id: "web_fetch",
    name: "Fetch a web page",
    description:
      "Fetches a URL and returns the response body as text, truncated to 4000 characters. Restricted to a fixed allow-list of hosts.",
    inputSchema: z.object({ url: z.string().url() }),
    permissions: { network: allowedHosts, filesystem: [] },
    // A GET against a fixed allow-list of hosts — read-only, no state change.
    sensitive: false,
    async run({ url }, ctx) {
      const res = await ctx.fetch(url);
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 4000) };
    },
  });
}
