export const EMPTY_ASSISTANT_RESPONSE =
	"I couldn't produce a visible response just now. Please try again or rephrase your request.";

export function ensureVisibleAssistantResponse(text: string): string {
	return text.trim() ? text : EMPTY_ASSISTANT_RESPONSE;
}

export function buildStreamFailureResponse(
	streamedText: string,
	messageText: string,
): string {
	return ensureVisibleAssistantResponse(
		streamedText ||
			`I couldn't stream the full response. ${messageText}`,
	);
}