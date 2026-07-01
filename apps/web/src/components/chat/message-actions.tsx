"use client";

import {
	Check,
	Copy,
	Pencil,
	RotateCw,
	ThumbsDown,
	ThumbsUp,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

function ActionButton({
	onClick,
	label,
	active,
	children,
}: {
	onClick: () => void;
	label: string;
	active?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={cn(
				"flex size-7 items-center justify-center rounded-full transition-colors",
				active
					? "text-primary hover:bg-primary/10"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

/**
 * Per-message action row under a turn's content — copy/read-aloud always
 * work; edit (user turns) and regenerate (assistant turns) are wired by the
 * caller and only rendered where it has a handler (currently: the latest
 * turn of each role — see message-list.tsx). Thumbs up/down are local UI
 * feedback only; there's no backend endpoint yet to persist a rating.
 */
export function MessageActions({
	text,
	isUser,
	onEdit,
	onRegenerate,
}: {
	text: string;
	isUser: boolean;
	onEdit?: () => void;
	onRegenerate?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [speaking, setSpeaking] = useState(false);
	const [rating, setRating] = useState<"up" | "down" | null>(null);

	function handleCopy() {
		navigator.clipboard?.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

	function handleSpeak() {
		if (typeof window === "undefined" || !window.speechSynthesis) return;
		if (speaking) {
			window.speechSynthesis.cancel();
			setSpeaking(false);
			return;
		}
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = "de-DE";
		utterance.onend = () => setSpeaking(false);
		utterance.onerror = () => setSpeaking(false);
		window.speechSynthesis.speak(utterance);
		setSpeaking(true);
	}

	return (
		<div className="-ml-1.5 flex items-center gap-0.5 pt-0.5">
			{!isUser && (
				<ActionButton
					onClick={handleSpeak}
					label={speaking ? "Vorlesen stoppen" : "Vorlesen"}
					active={speaking}
				>
					{speaking ? (
						<VolumeX className="size-3.5" />
					) : (
						<Volume2 className="size-3.5" />
					)}
				</ActionButton>
			)}
			<ActionButton onClick={handleCopy} label="Kopieren">
				{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
			</ActionButton>
			{isUser && onEdit && (
				<ActionButton onClick={onEdit} label="Bearbeiten">
					<Pencil className="size-3.5" />
				</ActionButton>
			)}
			{!isUser && onRegenerate && (
				<ActionButton onClick={onRegenerate} label="Neu generieren">
					<RotateCw className="size-3.5" />
				</ActionButton>
			)}
			{!isUser && (
				<>
					<ActionButton
						onClick={() => setRating((r) => (r === "up" ? null : "up"))}
						label="Gute Antwort"
						active={rating === "up"}
					>
						<ThumbsUp className="size-3.5" />
					</ActionButton>
					<ActionButton
						onClick={() => setRating((r) => (r === "down" ? null : "down"))}
						label="Schlechte Antwort"
						active={rating === "down"}
					>
						<ThumbsDown className="size-3.5" />
					</ActionButton>
				</>
			)}
		</div>
	);
}
