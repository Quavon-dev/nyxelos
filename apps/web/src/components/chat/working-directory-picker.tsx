"use client";

import { Check, ChevronDown, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

const LS_KEY = "nyxel:recent-working-dirs";
const MAX_RECENT = 8;

function loadRecent(): string[] {
	if (typeof window === "undefined") return [];
	try {
		return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as string[];
	} catch {
		return [];
	}
}

function saveRecent(dirs: string[]) {
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(dirs.slice(0, MAX_RECENT)));
	} catch {
		// ignore storage errors
	}
}

function withRecent(dir: string, existing: string[]): string[] {
	return [dir, ...existing.filter((d) => d !== dir)].slice(0, MAX_RECENT);
}

function dirBasename(p: string): string {
	return p.split("/").filter(Boolean).at(-1) ?? p;
}

interface WorkingDirectoryPickerProps {
	value: string;
	onChange: (dir: string) => void;
}

export function WorkingDirectoryPicker({
	value,
	onChange,
}: WorkingDirectoryPickerProps) {
	const [open, setOpen] = useState(false);
	const [recentDirs, setRecentDirs] = useState<string[]>([]);
	const [showInput, setShowInput] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Hydrate from localStorage on mount
	useEffect(() => {
		setRecentDirs(loadRecent());
	}, []);

	// Focus input when shown
	useEffect(() => {
		if (showInput) {
			const id = setTimeout(() => inputRef.current?.focus(), 30);
			return () => clearTimeout(id);
		}
	}, [showInput]);

	function commit(dir: string) {
		const trimmed = dir.trim();
		if (!trimmed) return;
		onChange(trimmed);
		const next = withRecent(trimmed, recentDirs);
		setRecentDirs(next);
		saveRecent(next);
		setOpen(false);
		setShowInput(false);
		setInputValue("");
	}

	async function handleOpenFolder() {
		if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const handle = await (window as any).showDirectoryPicker({
					mode: "read",
				});
				// Browser API can only give us the directory name, not the full path.
				// Pre-fill the input so the user can complete the absolute path.
				setInputValue(handle.name as string);
				setShowInput(true);
				return;
			} catch {
				// User cancelled the dialog — just show the text input
			}
		}
		setShowInput(true);
		setInputValue("");
	}

	function handleOpenChange(next: boolean) {
		setOpen(next);
		if (!next) {
			setShowInput(false);
			setInputValue("");
		}
	}

	const label = value ? dirBasename(value) : "Ordner";

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex h-8 shrink-0 items-center gap-1 rounded-full border-none bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
				>
					<FolderOpen className="size-3.5 shrink-0" />
					<span className="max-w-[108px] truncate">{label}</span>
					<ChevronDown className="size-3 shrink-0 opacity-60" />
				</button>
			</PopoverTrigger>

			<PopoverContent
				className="w-72 gap-0 p-1"
				align="start"
				sideOffset={6}
			>
				{recentDirs.length > 0 && (
					<>
						<p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
							Zuletzt verwendet
						</p>
						{recentDirs.map((dir) => (
							<button
								key={dir}
								type="button"
								onClick={() => commit(dir)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
							>
								<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="flex-1 truncate text-xs">{dir}</span>
								{dir === value && (
									<Check className="size-3.5 shrink-0 text-primary" />
								)}
							</button>
						))}
						<div className="my-1 h-px bg-border" />
					</>
				)}

				{showInput ? (
					<div className="flex items-center gap-1 px-2 py-1.5">
						<input
							ref={inputRef}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") commit(inputValue);
								if (e.key === "Escape") {
									setShowInput(false);
									setInputValue("");
								}
							}}
							placeholder="/Users/…/mein-projekt"
							spellCheck={false}
							className="flex-1 rounded-md border bg-muted/60 px-2 py-1 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						<button
							type="button"
							onClick={() => commit(inputValue)}
							className="rounded-md bg-foreground px-2 py-1 text-xs text-background transition-opacity hover:opacity-80"
						>
							OK
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={handleOpenFolder}
						className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<FolderOpen className="size-3.5 shrink-0" />
						<span className="text-xs">Ordner öffnen…</span>
					</button>
				)}
			</PopoverContent>
		</Popover>
	);
}
