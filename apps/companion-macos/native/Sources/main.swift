import Contacts
import EventKit
import Foundation
import Photos

enum BridgeError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case permissionDenied(String)
    case unsupported(String)

    var description: String {
        switch self {
        case .invalidArguments(let message), .permissionDenied(let message), .unsupported(let message):
            return message
        }
    }
}

struct PermissionStatus: Codable {
    let calendar: String
    let contacts: String
    let photos: String
}

struct CompanionStatus: Codable {
    let backend: String
    let nativeBridgePath: String?
    let capabilities: Capabilities
    let permissions: PermissionStatus

    struct Capabilities: Codable {
        let calendar: Bool
        let contacts: Bool
        let photos: Bool
        let nativeBridge: Bool
    }
}

struct CalendarEventRecord: Codable {
    let id: String
    let calendarName: String
    let title: String
    let start: String
    let end: String
    let location: String?
    let notes: String?
    let allDay: Bool
}

struct ContactRecord: Codable {
    let id: String
    let fullName: String
    let organization: String?
    let emails: [String]
    let phoneNumbers: [String]
    let notes: String?
}

struct PhotoRecord: Codable {
    let id: String
    let title: String
    let createdAt: String?
    let filename: String?
    let width: Int?
    let height: Int?
    let favorite: Bool?
    let hidden: Bool?
    let mediaType: String?
    let path: String?
}

struct ListEventsInput: Codable {
    let start: String
    let end: String
    let limit: Int
    let query: String
    let calendarNames: [String]
    let includeNotes: Bool
}

struct SearchContactsInput: Codable {
    let query: String
    let limit: Int
    let includeNotes: Bool
}

struct SearchPhotosInput: Codable {
    let query: String
    let from: String
    let to: String
    let limit: Int
    let includeHidden: Bool
}

struct ResponseEnvelope<T: Codable>: Codable {
    let ok: Bool
    let data: T?
    let error: String?

    init(data: T) {
        self.ok = true
        self.data = data
        self.error = nil
    }

    init(error: String) {
        self.ok = false
        self.data = nil
        self.error = error
    }
}

@main
struct NyxelLocalBridge {
    static func main() async {
        do {
            let result = try await run(arguments: Array(CommandLine.arguments.dropFirst()))
            try writeJSON(result)
        } catch {
            try? writeJSON(ResponseEnvelope<String>(error: error.localizedDescription))
            fputs("[nyxel-local-bridge] \(error)\n", stderr)
            Foundation.exit(1)
        }
    }

    static func run(arguments: [String]) async throws -> any Codable {
        guard let command = arguments.first else {
            throw BridgeError.invalidArguments("Expected a command.")
        }

        let payload = try decodePayload(from: arguments.dropFirst().first)

        switch command {
        case "status":
            return ResponseEnvelope(data: try await status())
        case "calendar-list-events":
            let input = try decode(ListEventsInput.self, from: payload)
            return ResponseEnvelope(data: try await listCalendarEvents(input: input))
        case "contacts-search":
            let input = try decode(SearchContactsInput.self, from: payload)
            return ResponseEnvelope(data: try await searchContacts(input: input))
        case "photos-search":
            let input = try decode(SearchPhotosInput.self, from: payload)
            return ResponseEnvelope(data: try await searchPhotos(input: input))
        default:
            throw BridgeError.invalidArguments("Unknown command: \(command)")
        }
    }

    static func decodePayload(from raw: String?) throws -> Data {
        guard let raw else { return Data("{}".utf8) }
        return Data(raw.utf8)
    }

    static func decode<T: Decodable>(_ type: T.Type, from payload: Data) throws -> T {
        try JSONDecoder().decode(type, from: payload)
    }

    static func writeJSON<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
    }

    static func isoString(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func parseISODate(_ raw: String) throws -> Date {
        guard let date = ISO8601DateFormatter().date(from: raw) else {
            throw BridgeError.invalidArguments("Invalid ISO date: \(raw)")
        }
        return date
    }

    static func mapCalendarStatus(_ status: EKAuthorizationStatus) -> String {
        if #available(macOS 14.0, *) {
            switch status {
            case .fullAccess, .writeOnly:
                return "authorized"
            case .restricted, .denied:
                return "denied"
            case .notDetermined:
                return "not_determined"
            @unknown default:
                return "unavailable"
            }
        } else {
            switch status {
            case .authorized:
                return "authorized"
            case .fullAccess, .writeOnly:
                return "authorized"
            case .restricted, .denied:
                return "denied"
            case .notDetermined:
                return "not_determined"
            @unknown default:
                return "unavailable"
            }
        }
    }

    static func mapContactsStatus(_ status: CNAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "authorized"
        case .denied, .restricted:
            return "denied"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unavailable"
        }
    }

    static func mapPhotosStatus(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "authorized"
        case .limited:
            return "limited"
        case .denied, .restricted:
            return "denied"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unavailable"
        }
    }

    static func status() async throws -> CompanionStatus {
        CompanionStatus(
            backend: "native",
            nativeBridgePath: CommandLine.arguments.first,
            capabilities: .init(calendar: true, contacts: true, photos: true, nativeBridge: true),
            permissions: .init(
                calendar: mapCalendarStatus(EKEventStore.authorizationStatus(for: .event)),
                contacts: mapContactsStatus(CNContactStore.authorizationStatus(for: .contacts)),
                photos: mapPhotosStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite))
            )
        )
    }

    static func requestCalendarAccess(_ store: EKEventStore) async throws {
        let current = EKEventStore.authorizationStatus(for: .event)
        if #available(macOS 14.0, *) {
            if current == .fullAccess || current == .writeOnly { return }
        } else if current == .authorized {
            return
        }
        if current == .denied || current == .restricted {
            throw BridgeError.permissionDenied("Calendar access was denied.")
        }

        let granted: Bool
        if #available(macOS 14.0, *) {
            granted = try await withCheckedThrowingContinuation { continuation in
                store.requestFullAccessToEvents { granted, error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume(returning: granted) }
                }
            }
        } else {
            granted = try await withCheckedThrowingContinuation { continuation in
                store.requestAccess(to: .event) { granted, error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume(returning: granted) }
                }
            }
        }

        if !granted {
            throw BridgeError.permissionDenied("Calendar access was not granted.")
        }
    }

    static func requestContactsAccess(_ store: CNContactStore) async throws {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized { return }
        if status == .denied || status == .restricted {
            throw BridgeError.permissionDenied("Contacts access was denied.")
        }

        let granted: Bool = try await withCheckedThrowingContinuation { continuation in
            store.requestAccess(for: .contacts) { granted, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: granted) }
            }
        }

        if !granted {
            throw BridgeError.permissionDenied("Contacts access was not granted.")
        }
    }

    static func requestPhotosAccess() async throws {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .authorized || status == .limited { return }
        if status == .denied || status == .restricted {
            throw BridgeError.permissionDenied("Photos access was denied.")
        }

        let result = await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                continuation.resume(returning: status)
            }
        }

        if result != .authorized && result != .limited {
            throw BridgeError.permissionDenied("Photos access was not granted.")
        }
    }

    static func listCalendarEvents(input: ListEventsInput) async throws -> [CalendarEventRecord] {
        let store = EKEventStore()
        try await requestCalendarAccess(store)

        let start = try parseISODate(input.start)
        let end = try parseISODate(input.end)
        let selectedCalendars = input.calendarNames.isEmpty
            ? nil
            : store.calendars(for: .event).filter { input.calendarNames.contains($0.title) }

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: selectedCalendars)
        let normalizedQuery = input.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        return store.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .filter { event in
                guard !normalizedQuery.isEmpty else { return true }
                let haystack = [
                    event.title,
                    event.location,
                    input.includeNotes ? event.notes : nil,
                    event.calendar.title,
                ]
                .compactMap { $0?.lowercased() }
                .joined(separator: " ")
                return haystack.contains(normalizedQuery)
            }
            .prefix(input.limit)
            .map { event in
                CalendarEventRecord(
                    id: event.eventIdentifier,
                    calendarName: event.calendar.title,
                    title: event.title,
                    start: isoString(event.startDate) ?? input.start,
                    end: isoString(event.endDate) ?? input.end,
                    location: event.location,
                    notes: input.includeNotes ? event.notes : nil,
                    allDay: event.isAllDay
                )
            }
    }

    static func searchContacts(input: SearchContactsInput) async throws -> [ContactRecord] {
        let store = CNContactStore()
        try await requestContactsAccess(store)

        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactNicknameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactNoteKey as CNKeyDescriptor,
        ]

        let predicate = CNContact.predicateForContacts(matchingName: input.query)
        let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
        let normalizedQuery = input.query.lowercased()

        return contacts
            .filter { contact in
                let haystack: [String] = [
                    CNContactFormatter.string(from: contact, style: .fullName),
                    contact.organizationName,
                    contact.nickname,
                    input.includeNotes ? contact.note : nil,
                ]
                .compactMap { $0 }
                + contact.emailAddresses.map(\.value).map(String.init)
                + contact.phoneNumbers.map { $0.value.stringValue }

                return haystack
                    .joined(separator: " ")
                    .lowercased()
                    .contains(normalizedQuery)
            }
            .prefix(input.limit)
            .map { contact in
                ContactRecord(
                    id: contact.identifier,
                    fullName: CNContactFormatter.string(from: contact, style: .fullName) ?? "(unnamed contact)",
                    organization: contact.organizationName.isEmpty ? nil : contact.organizationName,
                    emails: contact.emailAddresses.map(\.value).map(String.init),
                    phoneNumbers: contact.phoneNumbers.map { $0.value.stringValue },
                    notes: input.includeNotes && !contact.note.isEmpty ? contact.note : nil
                )
            }
    }

    static func mediaTypeString(_ type: PHAssetMediaType) -> String {
        switch type {
        case .image:
            return "image"
        case .video:
            return "video"
        case .audio:
            return "audio"
        default:
            return "unknown"
        }
    }

    static func searchPhotos(input: SearchPhotosInput) async throws -> [PhotoRecord] {
        try await requestPhotosAccess()

        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        var predicates: [NSPredicate] = []

        if !input.includeHidden {
            predicates.append(NSPredicate(format: "hidden == NO"))
        }
        if !input.from.isEmpty {
            predicates.append(NSPredicate(format: "creationDate >= %@", try parseISODate(input.from) as NSDate))
        }
        if !input.to.isEmpty {
            predicates.append(NSPredicate(format: "creationDate <= %@", try parseISODate(input.to) as NSDate))
        }
        if !predicates.isEmpty {
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        }

        let assets = PHAsset.fetchAssets(with: options)
        let query = input.query.lowercased()
        var results: [PhotoRecord] = []

        assets.enumerateObjects { asset, _, stop in
            if results.count >= input.limit {
                stop.pointee = true
                return
            }

            let resources = PHAssetResource.assetResources(for: asset)
            let filename = resources.first?.originalFilename
            let title = filename ?? asset.localIdentifier
            let haystack = [title, asset.localIdentifier].joined(separator: " ").lowercased()

            if !query.isEmpty && !haystack.contains(query) {
                return
            }

            results.append(
                PhotoRecord(
                    id: asset.localIdentifier,
                    title: title,
                    createdAt: isoString(asset.creationDate),
                    filename: filename,
                    width: asset.pixelWidth,
                    height: asset.pixelHeight,
                    favorite: asset.isFavorite,
                    hidden: asset.isHidden,
                    mediaType: mediaTypeString(asset.mediaType),
                    path: nil
                )
            )
        }

        return results
    }
}
