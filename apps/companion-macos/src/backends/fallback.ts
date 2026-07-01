import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CalendarEvent,
  CompanionStatus,
  CreateReminderInput,
  ContactRecord,
  ListEventsInput,
  ListRemindersInput,
  PermissionState,
  PhotoRecord,
  ReminderRecord,
  SearchContactsInput,
  SearchPhotosInput,
} from "../contracts.ts";
import type { LocalDataBackend } from "./types.ts";

const execFileAsync = promisify(execFile);

function normalizeAppleState(stderr: string): PermissionState {
  const lower = stderr.toLowerCase();
  if (
    lower.includes("not authorized") ||
    lower.includes("not permitted") ||
    lower.includes("(-1743)") ||
    lower.includes("(-10004)")
  ) {
    return "denied";
  }
  if (lower.includes("application isn’t running") || lower.includes("can't get")) {
    return "not_determined";
  }
  return "unavailable";
}

async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-l", "AppleScript", "-e", script], {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

async function runMdFind(query: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "mdfind",
    ["-onlyin", `${process.env.HOME}/Pictures`, query],
    {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runMdls(path: string): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync(
    "mdls",
    [
      "-name",
      "kMDItemFSName",
      "-name",
      "kMDItemDisplayName",
      "-name",
      "kMDItemContentCreationDate",
      "-name",
      "kMDItemPixelWidth",
      "-name",
      "kMDItemPixelHeight",
      path,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );

  const result: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (!key || rest.length === 0) continue;
    result[key.trim()] = rest.join("=").trim().replace(/^"|"$/g, "");
  }
  return result;
}

function splitRecords(output: string): string[][] {
  const recordSeparator = String.fromCharCode(30);
  const fieldSeparator = String.fromCharCode(31);
  if (!output) return [];
  return output
    .split(recordSeparator)
    .map((record) => record.split(fieldSeparator).map((field) => field.trim()))
    .filter((fields) => fields.some(Boolean));
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export class FallbackBackend implements LocalDataBackend {
  async getStatus(): Promise<CompanionStatus> {
    const permissions = {
      calendar: "unavailable" as PermissionState,
      contacts: "unavailable" as PermissionState,
      photos: "authorized" as PermissionState,
      reminders: "unavailable" as PermissionState,
    };

    try {
      await runOsascript('tell application "Calendar" to get name of first calendar');
      permissions.calendar = "authorized";
    } catch (error) {
      permissions.calendar = normalizeAppleState(
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      await runOsascript('tell application "Contacts" to get name of first person');
      permissions.contacts = "authorized";
    } catch (error) {
      permissions.contacts = normalizeAppleState(
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      await runOsascript('tell application "Reminders" to get name of default list');
      permissions.reminders = "authorized";
    } catch (error) {
      permissions.reminders = normalizeAppleState(
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      backend: "fallback",
      nativeBridgePath: null,
      capabilities: {
        calendar: true,
        contacts: true,
        photos: true,
        reminders: true,
        nativeBridge: false,
      },
      permissions,
    };
  }

  async listCalendarEvents(input: Required<ListEventsInput>): Promise<CalendarEvent[]> {
    const escapedQuery = JSON.stringify(input.query);
    const escapedCalendars = JSON.stringify(input.calendarNames);
    const script = `
      set fieldSeparator to character id 31
      set recordSeparator to character id 30
      set queryText to ${escapedQuery}
      set allowedCalendarsJson to ${escapedCalendars}
      set startBoundary to date "${new Date(input.start).toUTCString()}"
      set endBoundary to date "${new Date(input.end).toUTCString()}"
      set maxCount to ${input.limit}

      on containsText(haystack, needle)
        if needle is "" then return true
        return (offset of needle in haystack) is not 0
      end containsText

      on inCalendarList(calendarName, allowedCalendars)
        if (count of allowedCalendars) is 0 then return true
        repeat with allowedName in allowedCalendars
          if calendarName is equal to allowedName then return true
        end repeat
        return false
      end inCalendarList

      on normalizedText(valueText)
        if valueText is missing value then return ""
        set valueText to (valueText as text)
        set valueText to do shell script "printf %s " & quoted form of valueText & " | tr '\\n\\r' '  '"
        return valueText
      end normalizedText

      set oldDelimiters to AppleScript's text item delimiters
      set AppleScript's text item delimiters to ","
      set allowedCalendars to {}
      if allowedCalendarsJson is not "[]" then
        set rawCalendars to do shell script "python3 - <<'PY'\nimport json\nfor item in json.loads(" & quoted form of allowedCalendarsJson & "):\n    print(item)\nPY"
        if rawCalendars is not "" then set allowedCalendars to paragraphs of rawCalendars
      end if

      tell application "Calendar"
        set outputRecords to {}
        repeat with cal in calendars
          set calName to my normalizedText(name of cal)
          if my inCalendarList(calName, allowedCalendars) then
            set matchingEvents to (every event of cal whose start date ≥ startBoundary and start date ≤ endBoundary)
            repeat with ev in matchingEvents
              set titleText to my normalizedText(summary of ev)
              set locationText to my normalizedText(location of ev)
              set notesText to ""
              if ${input.includeNotes ? "true" : "false"} then set notesText to my normalizedText(description of ev)
              set searchableText to (titleText & " " & locationText & " " & notesText)
              if my containsText(searchableText, queryText) then
                set end of outputRecords to ((uid of ev as text) & fieldSeparator & calName & fieldSeparator & titleText & fieldSeparator & ((start date of ev) as text) & fieldSeparator & ((end date of ev) as text) & fieldSeparator & locationText & fieldSeparator & notesText & fieldSeparator & ((allday event of ev) as text))
                if (count of outputRecords) ≥ maxCount then exit repeat
              end if
            end repeat
          end if
          if (count of outputRecords) ≥ maxCount then exit repeat
        end repeat
      end tell

      set AppleScript's text item delimiters to recordSeparator
      set finalOutput to outputRecords as text
      set AppleScript's text item delimiters to oldDelimiters
      return finalOutput
    `;

    const output = await runOsascript(script);

    return splitRecords(output).map(
      ([id, calendarName, title, start, end, location, notes, allDay]) => ({
        id: id || `${calendarName}-${title}-${start}`,
        calendarName: calendarName || "Calendar",
        title: title || "(untitled)",
        start: isoDate(start) ?? start ?? "",
        end: isoDate(end) ?? end ?? "",
        location: location || null,
        notes: notes || null,
        allDay: allDay === "true",
      }),
    );
  }

  async searchContacts(input: Required<SearchContactsInput>): Promise<ContactRecord[]> {
    const escapedQuery = JSON.stringify(input.query.toLowerCase());
    const script = `
      set fieldSeparator to character id 31
      set recordSeparator to character id 30
      set queryText to ${escapedQuery}
      set maxCount to ${input.limit}

      on normalizedText(valueText)
        if valueText is missing value then return ""
        set valueText to (valueText as text)
        set valueText to do shell script "printf %s " & quoted form of valueText & " | tr '\\n\\r' '  '"
        return valueText
      end normalizedText

      on containsText(haystack, needle)
        if needle is "" then return true
        return (offset of needle in haystack) is not 0
      end containsText

      on joinValues(valueList)
        set oldDelimiters to AppleScript's text item delimiters
        set AppleScript's text item delimiters to ", "
        set joinedValue to valueList as text
        set AppleScript's text item delimiters to oldDelimiters
        return joinedValue
      end joinValues

      tell application "Contacts"
        set outputRecords to {}
        repeat with personRecord in people
          set fullName to my normalizedText(name of personRecord)
          set orgName to my normalizedText(organization of personRecord)
          set emailValues to {}
          repeat with anEmail in emails of personRecord
            set end of emailValues to my normalizedText(value of anEmail)
          end repeat
          set phoneValues to {}
          repeat with aPhone in phones of personRecord
            set end of phoneValues to my normalizedText(value of aPhone)
          end repeat
          set notesText to ""
          if ${input.includeNotes ? "true" : "false"} then set notesText to my normalizedText(note of personRecord)
          set emailsText to my joinValues(emailValues)
          set phonesText to my joinValues(phoneValues)
          set searchableText to (fullName & " " & orgName & " " & emailsText & " " & phonesText & " " & notesText)
          if my containsText((do shell script "printf %s " & quoted form of searchableText & " | tr '[:upper:]' '[:lower:]'"), queryText) then
            set end of outputRecords to ((id of personRecord as text) & fieldSeparator & fullName & fieldSeparator & orgName & fieldSeparator & emailsText & fieldSeparator & phonesText & fieldSeparator & notesText)
            if (count of outputRecords) ≥ maxCount then exit repeat
          end if
        end repeat
      end tell

      set oldDelimiters to AppleScript's text item delimiters
      set AppleScript's text item delimiters to recordSeparator
      set finalOutput to outputRecords as text
      set AppleScript's text item delimiters to oldDelimiters
      return finalOutput
    `;

    const output = await runOsascript(script);

    return splitRecords(output).map(
      ([id, fullName, organization, emails, phoneNumbers, notes]) => ({
        id: id || fullName || crypto.randomUUID(),
        fullName: fullName || "(unnamed contact)",
        organization: organization || null,
        emails: emails ? emails.split(", ").filter(Boolean) : [],
        phoneNumbers: phoneNumbers ? phoneNumbers.split(", ").filter(Boolean) : [],
        notes: notes || null,
      }),
    );
  }

  async searchPhotos(input: Required<SearchPhotosInput>): Promise<PhotoRecord[]> {
    const filters: string[] = [
      '(kMDItemContentTypeTree == "public.image" || kMDItemContentTypeTree == "public.movie")',
    ];

    if (input.query) {
      const escaped = input.query.replace(/"/g, '\\"');
      filters.push(`(kMDItemFSName == "*${escaped}*"cd || kMDItemDisplayName == "*${escaped}*"cd)`);
    }

    if (input.from) {
      filters.push(`kMDItemContentCreationDate >= $time.iso(${JSON.stringify(input.from)})`);
    }

    if (input.to) {
      filters.push(`kMDItemContentCreationDate <= $time.iso(${JSON.stringify(input.to)})`);
    }

    const paths = await runMdFind(filters.join(" && "));
    const rows = await Promise.all(
      paths.slice(0, input.limit).map((path) => runMdls(path).then((meta) => ({ path, meta }))),
    );

    return rows.map(({ path, meta }, index) => ({
      id: path,
      title: meta.kMDItemDisplayName || meta.kMDItemFSName || `photo-${index + 1}`,
      createdAt: isoDate(meta.kMDItemContentCreationDate),
      filename: meta.kMDItemFSName || null,
      width: meta.kMDItemPixelWidth ? Number(meta.kMDItemPixelWidth) : null,
      height: meta.kMDItemPixelHeight ? Number(meta.kMDItemPixelHeight) : null,
      favorite: null,
      hidden: null,
      mediaType:
        path.toLowerCase().endsWith(".mov") || path.toLowerCase().endsWith(".mp4")
          ? "video"
          : "image",
      path,
    }));
  }

  async listReminders(input: Required<ListRemindersInput>): Promise<ReminderRecord[]> {
    const escapedQuery = JSON.stringify(input.query.toLowerCase());
    const escapedLists = JSON.stringify(input.listNames);
    const script = `
      set fieldSeparator to character id 31
      set recordSeparator to character id 30
      set queryText to ${escapedQuery}
      set allowedListsJson to ${escapedLists}
      set maxCount to ${input.limit}

      on normalizedText(valueText)
        if valueText is missing value then return ""
        set valueText to (valueText as text)
        set valueText to do shell script "printf %s " & quoted form of valueText & " | tr '\\n\\r' '  '"
        return valueText
      end normalizedText

      on containsText(haystack, needle)
        if needle is "" then return true
        return (offset of needle in haystack) is not 0
      end containsText

      on inListName(listName, allowedLists)
        if (count of allowedLists) is 0 then return true
        repeat with allowedName in allowedLists
          if listName is equal to allowedName then return true
        end repeat
        return false
      end inListName

      set oldDelimiters to AppleScript's text item delimiters
      set AppleScript's text item delimiters to ","
      set allowedLists to {}
      if allowedListsJson is not "[]" then
        set rawLists to do shell script "python3 - <<'PY'\nimport json\nfor item in json.loads(" & quoted form of allowedListsJson & "):\n    print(item)\nPY"
        if rawLists is not "" then set allowedLists to paragraphs of rawLists
      end if

      tell application "Reminders"
        set outputRecords to {}
        repeat with reminderList in lists
          set listName to my normalizedText(name of reminderList)
          if my inListName(listName, allowedLists) then
            repeat with reminderItem in reminders of reminderList
              set completedText to (completed of reminderItem as text)
              if ${input.includeCompleted ? "true" : "false"} or completedText is "false" then
                set dueText to ""
                if due date of reminderItem is not missing value then set dueText to (due date of reminderItem as text)
                set remindText to ""
                if remind me date of reminderItem is not missing value then set remindText to (remind me date of reminderItem as text)
                set notesText to ""
                if ${input.includeNotes ? "true" : "false"} then set notesText to my normalizedText(body of reminderItem)
                set searchText to my normalizedText(name of reminderItem) & " " & listName & " " & notesText
                set searchText to do shell script "printf %s " & quoted form of searchText & " | tr '[:upper:]' '[:lower:]'"
                set dueOk to true
                if ${input.from ? "true" : "false"} and dueText is not "" then set dueOk to ((date dueText) ≥ (date "${new Date(input.from || 0).toUTCString()}"))
                if ${input.from ? "true" : "false"} and dueText is "" then set dueOk to false
                if dueOk and ${input.to ? "true" : "false"} and dueText is not "" then set dueOk to ((date dueText) ≤ (date "${new Date(input.to || 0).toUTCString()}"))
                if dueOk and ${input.to ? "true" : "false"} and dueText is "" then set dueOk to false
                if dueOk and my containsText(searchText, queryText) then
                  set completionText to ""
                  if completion date of reminderItem is not missing value then set completionText to (completion date of reminderItem as text)
                  set end of outputRecords to ((id of reminderItem as text) & fieldSeparator & listName & fieldSeparator & my normalizedText(name of reminderItem) & fieldSeparator & notesText & fieldSeparator & dueText & fieldSeparator & remindText & fieldSeparator & completedText & fieldSeparator & (priority of reminderItem as text) & fieldSeparator & ((flagged of reminderItem) as text) & fieldSeparator & ((creation date of reminderItem) as text) & fieldSeparator & completionText)
                  if (count of outputRecords) ≥ maxCount then exit repeat
                end if
              end if
            end repeat
          end if
          if (count of outputRecords) ≥ maxCount then exit repeat
        end repeat
      end tell

      set AppleScript's text item delimiters to recordSeparator
      set finalOutput to outputRecords as text
      set AppleScript's text item delimiters to oldDelimiters
      return finalOutput
    `;

    const output = await runOsascript(script);

    return splitRecords(output).map(
      ([id, listName, title, notes, dueDate, remindAt, completed, priority, flagged, creationDate, completionDate]) => ({
        id: id || `${listName}-${title}`,
        listName: listName || "Reminders",
        title: title || "(untitled reminder)",
        notes: notes || null,
        dueDate: isoDate(dueDate) ?? dueDate ?? null,
        remindAt: isoDate(remindAt) ?? remindAt ?? null,
        completed: completed === "true",
        priority: priority ? Number(priority) : null,
        flagged: flagged === "true",
        creationDate: isoDate(creationDate) ?? creationDate ?? null,
        completionDate: isoDate(completionDate) ?? completionDate ?? null,
      }),
    );
  }

  async createReminder(input: CreateReminderInput): Promise<ReminderRecord> {
    const title = JSON.stringify(input.title);
    const listName = input.listName ? JSON.stringify(input.listName) : null;
    const notes = input.notes ? JSON.stringify(input.notes) : null;
    const dueDate = input.dueDate ? new Date(input.dueDate).toUTCString() : null;
    const remindAt = input.remindAt ? new Date(input.remindAt).toUTCString() : null;
    const script = `
      set fieldSeparator to character id 31
      set titleText to ${title}
      tell application "Reminders"
        set targetList to ${listName ? `first list whose name is ${listName}` : "default list"}
        set newReminder to make new reminder at end of reminders of targetList with properties {name:titleText}
        ${notes ? `set body of newReminder to ${notes}` : ""}
        ${dueDate ? `set due date of newReminder to date "${dueDate}"` : ""}
        ${remindAt ? `set remind me date of newReminder to date "${remindAt}"` : ""}
        ${typeof input.priority === "number" ? `set priority of newReminder to ${input.priority}` : ""}
        ${typeof input.flagged === "boolean" ? `set flagged of newReminder to ${input.flagged ? "true" : "false"}` : ""}
        return (id of newReminder as text) & fieldSeparator & (name of targetList as text) & fieldSeparator & (name of newReminder as text)
      end tell
    `;

    const [id, resolvedListName, resolvedTitle] = splitRecords(await runOsascript(script))[0] ?? [];
    return {
      id: id || crypto.randomUUID(),
      listName: resolvedListName || input.listName || "Reminders",
      title: resolvedTitle || input.title,
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      remindAt: input.remindAt ?? null,
      completed: false,
      priority: input.priority ?? null,
      flagged: input.flagged ?? null,
      creationDate: new Date().toISOString(),
      completionDate: null,
    };
  }
}
