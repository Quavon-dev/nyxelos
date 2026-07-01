import type {
  CalendarEvent,
  CompanionStatus,
  ContactRecord,
  ListEventsInput,
  PhotoRecord,
  SearchContactsInput,
  SearchPhotosInput,
} from "../contracts.ts";

export interface LocalDataBackend {
  getStatus(): Promise<CompanionStatus>;
  listCalendarEvents(input: Required<ListEventsInput>): Promise<CalendarEvent[]>;
  searchContacts(input: Required<SearchContactsInput>): Promise<ContactRecord[]>;
  searchPhotos(input: Required<SearchPhotosInput>): Promise<PhotoRecord[]>;
}
