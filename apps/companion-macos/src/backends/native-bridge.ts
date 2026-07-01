import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CalendarEvent,
  CompanionStatus,
  ContactRecord,
  ListEventsInput,
  PhotoRecord,
  SearchContactsInput,
  SearchPhotosInput,
} from "../contracts.ts";
import type { LocalDataBackend } from "./types.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

interface NativeCommandResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveNativeBridgePath(): Promise<string | null> {
  const envPath = process.env.NYXEL_COMPANION_NATIVE_BRIDGE;
  const candidates = [
    envPath,
    resolve(__dirname, "../../native/.build/release/nyxel-local-bridge"),
    resolve(__dirname, "../../native/.build/debug/nyxel-local-bridge"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await canExecute(candidate)) return candidate;
  }

  return null;
}

export class NativeBridgeBackend implements LocalDataBackend {
  private readonly bridgePath: string;

  constructor(bridgePath: string) {
    this.bridgePath = bridgePath;
  }

  private async run<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
    const args = [command];
    if (payload) args.push(JSON.stringify(payload));

    const { stdout, stderr } = await execFileAsync(this.bridgePath, args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    let parsed: NativeCommandResult<T>;
    try {
      parsed = JSON.parse(stdout) as NativeCommandResult<T>;
    } catch (error) {
      throw new Error(
        `Native bridge returned invalid JSON for "${command}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!parsed.ok) {
      throw new Error(
        parsed.error ?? (stderr.trim() || `Native bridge command "${command}" failed.`),
      );
    }

    if (parsed.data === undefined) {
      throw new Error(`Native bridge command "${command}" returned no data.`);
    }

    return parsed.data;
  }

  getStatus(): Promise<CompanionStatus> {
    return this.run<CompanionStatus>("status");
  }

  listCalendarEvents(input: Required<ListEventsInput>): Promise<CalendarEvent[]> {
    return this.run<CalendarEvent[]>("calendar-list-events", input);
  }

  searchContacts(input: Required<SearchContactsInput>): Promise<ContactRecord[]> {
    return this.run<ContactRecord[]>("contacts-search", input);
  }

  searchPhotos(input: Required<SearchPhotosInput>): Promise<PhotoRecord[]> {
    return this.run<PhotoRecord[]>("photos-search", input);
  }
}
