import { z } from "zod";
import { defineSkill } from "../define-skill";

export const getCurrentTimeSkill = defineSkill({
  id: "get_current_time",
  name: "Get current time",
  description:
    "Returns the current date and time in ISO 8601 format, optionally formatted for a given IANA time zone.",
  inputSchema: z.object({
    timeZone: z.string().optional().describe('IANA time zone, e.g. "Europe/Berlin"'),
  }),
  permissions: { network: [], filesystem: [] },
  async run({ timeZone }) {
    const now = new Date();
    return {
      iso: now.toISOString(),
      formatted: timeZone
        ? new Intl.DateTimeFormat("en-US", {
            dateStyle: "full",
            timeStyle: "long",
            timeZone,
          }).format(now)
        : now.toString(),
    };
  },
});
