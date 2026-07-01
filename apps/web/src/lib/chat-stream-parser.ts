export function extractSseData(buffer: string): {
	remaining: string;
	text: string;
} {
	let remaining = buffer;
	let text = "";

	for (;;) {
		const separatorIndex = remaining.indexOf("\n\n");
		if (separatorIndex === -1) break;

		const frame = remaining.slice(0, separatorIndex);
		remaining = remaining.slice(separatorIndex + 2);

		const data = frame
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).replace(/^ /, ""))
			.join("\n");

		text += data;
	}

	return { remaining, text };
}
