import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type {
  CalendarEvent,
  CompanionStatus,
  ContactRecord,
  ListEventsInput,
  PhotoRecord,
  SearchContactsInput,
  SearchPhotosInput,
} from "./contracts.ts";
import { createLocalDataBackend } from "./backends/index.ts";

function summarizeEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No matching events found.";
  return events
    .slice(0, 5)
    .map((event) => `${event.start} · ${event.title} (${event.calendarName})`)
    .join("\n");
}

function summarizeContacts(contacts: ContactRecord[]): string {
  if (contacts.length === 0) return "No matching contacts found.";
  return contacts
    .slice(0, 5)
    .map((contact) => {
      const company = contact.organization ? ` · ${contact.organization}` : "";
      const detail = contact.emails[0] ?? contact.phoneNumbers[0] ?? "no email/phone";
      return `${contact.fullName}${company} · ${detail}`;
    })
    .join("\n");
}

function summarizePhotos(photos: PhotoRecord[]): string {
  if (photos.length === 0) return "No matching photos found.";
  return photos
    .slice(0, 5)
    .map((photo) => `${photo.createdAt ?? "unknown date"} · ${photo.title}`)
    .join("\n");
}

async function main(): Promise<void> {
  const backend = await createLocalDataBackend();
  const status = await backend.getStatus();
  console.error(
    `[nyxel companion] backend=${status.backend} nativeBridge=${status.nativeBridgePath ?? "none"}`,
  );

  const server = new McpServer(
    {
      name: "nyxel-companion-macos",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Provides local macOS calendar, contacts, and photo search tools. Read-only access only.",
    },
  );

  server.registerTool(
    "companion.status",
    {
      description:
        "Show which backend is active for the local macOS companion and the current permission state for calendar, contacts, and photos.",
    },
    async () => {
      const latestStatus: CompanionStatus = await backend.getStatus();
      return {
        content: [
          {
            type: "text",
            text: `Backend: ${latestStatus.backend}\nCalendar: ${latestStatus.permissions.calendar}\nContacts: ${latestStatus.permissions.contacts}\nPhotos: ${latestStatus.permissions.photos}`,
          },
        ],
        structuredContent: {
          backend: latestStatus.backend,
          nativeBridgePath: latestStatus.nativeBridgePath,
          capabilities: latestStatus.capabilities,
          permissions: latestStatus.permissions,
        },
      };
    },
  );

  server.registerTool(
    "calendar.list_events",
    {
      description:
        "List macOS Calendar events in a time range. Uses the native EventKit bridge when available and an AppleScript fallback otherwise.",
      inputSchema: {
        start: z
          .string()
          .datetime()
          .optional()
          .describe("Inclusive ISO-8601 start time. Defaults to now."),
        end: z
          .string()
          .datetime()
          .optional()
          .describe("Exclusive ISO-8601 end time. Defaults to 7 days after start."),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of events."),
        query: z
          .string()
          .optional()
          .describe("Optional case-insensitive text filter across title/location/notes."),
        calendarNames: z
          .array(z.string())
          .optional()
          .describe("Optional allow-list of calendar names to search."),
        includeNotes: z
          .boolean()
          .optional()
          .describe("Whether event notes should be read and included in text filtering."),
      },
    },
    async (rawInput: ListEventsInput = {}) => {
      const startDate = rawInput.start ? new Date(rawInput.start) : new Date();
      const endDate = rawInput.end
        ? new Date(rawInput.end)
        : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const input: Required<ListEventsInput> = {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        limit: rawInput.limit ?? 25,
        query: rawInput.query ?? "",
        calendarNames: rawInput.calendarNames ?? [],
        includeNotes: rawInput.includeNotes ?? false,
      };
      const events = await backend.listCalendarEvents(input);
      return {
        content: [
          {
            type: "text",
            text: summarizeEvents(events),
          },
        ],
        structuredContent: {
          backend: (await backend.getStatus()).backend,
          count: events.length,
          events,
        },
      };
    },
  );

  server.registerTool(
    "contacts.search",
    {
      description:
        "Search local macOS contacts by name, organization, email, or phone number. Uses Contacts.framework when available and an AppleScript fallback otherwise.",
      inputSchema: {
        query: z.string().min(1).describe("Search text for names, company names, email addresses, or phone numbers."),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of contacts."),
        includeNotes: z
          .boolean()
          .optional()
          .describe("Whether contact notes should be read and included in text filtering."),
      },
    },
    async (rawInput: SearchContactsInput) => {
      const input: Required<SearchContactsInput> = {
        query: rawInput.query,
        limit: rawInput.limit ?? 25,
        includeNotes: rawInput.includeNotes ?? false,
      };
      const contacts = await backend.searchContacts(input);
      return {
        content: [
          {
            type: "text",
            text: summarizeContacts(contacts),
          },
        ],
        structuredContent: {
          backend: (await backend.getStatus()).backend,
          count: contacts.length,
          contacts,
        },
      };
    },
  );

  server.registerTool(
    "photos.search",
    {
      description:
        "Search local photos. Uses the native PhotoKit bridge when available and a Spotlight-based fallback otherwise.",
      inputSchema: {
        query: z.string().optional().describe("Optional filename/title search query."),
        from: z
          .string()
          .datetime()
          .optional()
          .describe("Optional inclusive ISO-8601 start date filter."),
        to: z
          .string()
          .datetime()
          .optional()
          .describe("Optional inclusive ISO-8601 end date filter."),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of photos."),
        includeHidden: z.boolean().optional().describe("Include hidden assets when the backend supports it."),
      },
    },
    async (rawInput: SearchPhotosInput = {}) => {
      const input: Required<SearchPhotosInput> = {
        query: rawInput.query ?? "",
        from: rawInput.from ?? "",
        to: rawInput.to ?? "",
        limit: rawInput.limit ?? 25,
        includeHidden: rawInput.includeHidden ?? false,
      };
      const photos = await backend.searchPhotos(input);
      return {
        content: [
          {
            type: "text",
            text: summarizePhotos(photos),
          },
        ],
        structuredContent: {
          backend: (await backend.getStatus()).backend,
          count: photos.length,
          photos,
        },
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[nyxel companion] fatal:", error);
  process.exit(1);
});
