import type {
  CalendarEvent,
  CompanionStatus,
  CreateReminderInput,
  ContactRecord,
  ListEventsInput,
  ListRemindersInput,
  PhotoRecord,
  ReminderRecord,
  SearchContactsInput,
  SearchPhotosInput,
} from "../contracts.ts";

export interface LocalDataBackend {
  getStatus(): Promise<CompanionStatus>;
  listCalendarEvents(input: Required<ListEventsInput>): Promise<CalendarEvent[]>;
  searchContacts(input: Required<SearchContactsInput>): Promise<ContactRecord[]>;
  searchPhotos(input: Required<SearchPhotosInput>): Promise<PhotoRecord[]>;
  listReminders(input: Required<ListRemindersInput>): Promise<ReminderRecord[]>;
  createReminder(input: CreateReminderInput): Promise<ReminderRecord>;
}
