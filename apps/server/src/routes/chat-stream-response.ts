export const EMPTY_ASSISTANT_RESPONSE =
	"Ich konnte gerade keine sichtbare Antwort erzeugen. Bitte versuchen Sie es erneut oder formulieren Sie Ihre Anfrage etwas anders.";

export function ensureVisibleAssistantResponse(text: string): string {
	return text.trim() ? text : EMPTY_ASSISTANT_RESPONSE;
}

export function buildStreamFailureResponse(
	streamedText: string,
	messageText: string,
): string {
	return ensureVisibleAssistantResponse(
		streamedText ||
			`Ich konnte die Antwort nicht vollständig streamen. ${messageText}`,
	);
}