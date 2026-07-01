export type PermissionState =
  | "authorized"
  | "denied"
  | "limited"
  | "not_determined"
  | "unavailable";

export interface PermissionStatus {
  calendar: PermissionState;
  contacts: PermissionState;
  photos: PermissionState;
  reminders: PermissionState;
}

export interface CalendarEvent {
  id: string;
  calendarName: string;
  title: string;
  start: string;
  end: string;
  location?: string | null;
  notes?: string | null;
  allDay: boolean;
}

export interface ContactRecord {
  id: string;
  fullName: string;
  organization?: string | null;
  emails: string[];
  phoneNumbers: string[];
  notes?: string | null;
}

export interface PhotoRecord {
  id: string;
  title: string;
  createdAt?: string | null;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  favorite?: boolean | null;
  hidden?: boolean | null;
  mediaType?: string | null;
  path?: string | null;
}

export interface ReminderRecord {
  id: string;
  listName: string;
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  completed: boolean;
  priority?: number | null;
  flagged?: boolean | null;
  creationDate?: string | null;
  completionDate?: string | null;
}

export interface CompanionStatus {
  backend: string;
  nativeBridgePath?: string | null;
  capabilities: {
    calendar: boolean;
    contacts: boolean;
    photos: boolean;
    reminders: boolean;
    nativeBridge: boolean;
  };
  permissions: PermissionStatus;
}

export interface ListEventsInput {
  start?: string;
  end?: string;
  limit?: number;
  query?: string;
  calendarNames?: string[];
  includeNotes?: boolean;
}

export interface SearchContactsInput {
  query: string;
  limit?: number;
  includeNotes?: boolean;
}

export interface SearchPhotosInput {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  includeHidden?: boolean;
}

export interface ListRemindersInput {
  query?: string;
  listNames?: string[];
  includeCompleted?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  includeNotes?: boolean;
}

export interface CreateReminderInput {
  title: string;
  listName?: string;
  notes?: string;
  dueDate?: string;
  remindAt?: string;
  priority?: number;
  flagged?: boolean;
}
