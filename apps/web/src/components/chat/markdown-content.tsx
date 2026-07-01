"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Fenced code block with a language label + copy button in the header,
 * matching the "```lang ... Copy code```" treatment of a real code editor
 * rather than a plain <pre>. */
function CodeBlock({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	const [copied, setCopied] = useState(false);
	const language = /language-(\w+)/.exec(className ?? "")?.[1] ?? "text";
	const code = String(children).replace(/\n$/, "");

	function copy() {
		navigator.clipboard?.writeText(code).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

	return (
		<div className="mb-3 overflow-hidden rounded-xl border border-border/60 last:mb-0">
			<div className="flex items-center justify-between bg-foreground/[0.06] px-3.5 py-1.5 text-xs text-muted-foreground">
				<span className="font-mono lowercase">{language}</span>
				<button
					type="button"
					onClick={copy}
					className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
					{copied ? "Copied" : "Copy code"}
				</button>
			</div>
			<pre className="overflow-x-auto bg-foreground/[0.03] px-4 py-3 text-sm leading-relaxed">
				<code className={className}>{children}</code>
			</pre>
		</div>
	);
}

const components: Components = {
	// Headings
	h1: ({ children }) => (
		<h1 className="mb-3 mt-5 text-xl font-bold leading-tight first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="mb-2 mt-4 text-lg font-semibold leading-tight first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="mb-2 mt-3 text-base font-semibold leading-snug first:mt-0">
			{children}
		</h3>
	),
	h4: ({ children }) => (
		<h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>
	),
	h5: ({ children }) => (
		<h5 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h5>
	),
	h6: ({ children }) => (
		<h6 className="mb-1 mt-2 text-xs font-medium text-muted-foreground first:mt-0">
			{children}
		</h6>
	),

	// Paragraph
	p: ({ children }) => (
		<p className="mb-2 leading-relaxed last:mb-0">{children}</p>
	),

	// Lists
	ul: ({ children }) => (
		<ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
	),
	li: ({ children }) => <li className="leading-relaxed">{children}</li>,

	// Inline code vs. fenced code block — react-markdown only tells them apart
	// via the `inline` flag, so the block case delegates to CodeBlock and pre
	// (below) just unwraps it rather than double-wrapping in another <pre>.
	// biome-ignore lint/suspicious/noExplicitAny: react-markdown node typing
	code: ({ inline, className, children, ...props }: any) => {
		if (inline) {
			return (
				<code
					className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
					{...props}
				>
					{children}
				</code>
			);
		}
		return <CodeBlock className={className}>{children}</CodeBlock>;
	},

	// Code block wrapper — the actual <pre> lives inside CodeBlock.
	pre: ({ children }) => <>{children}</>,

	// Blockquote
	blockquote: ({ children }) => (
		<blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground last:mb-0">
			{children}
		</blockquote>
	),

	// Emphasis
	strong: ({ children }) => (
		<strong className="font-semibold">{children}</strong>
	),
	em: ({ children }) => <em className="italic">{children}</em>,

	// Link
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	),

	// Horizontal rule
	hr: () => <hr className="my-3 border-border" />,

	// Table (GFM)
	table: ({ children }) => (
		<div className="mb-3 overflow-x-auto last:mb-0">
			<table className="w-full border-collapse text-sm">{children}</table>
		</div>
	),
	thead: ({ children }) => (
		<thead className="border-b border-border">{children}</thead>
	),
	tbody: ({ children }) => <tbody>{children}</tbody>,
	tr: ({ children }) => (
		<tr className="border-b border-border/50 last:border-0">{children}</tr>
	),
	th: ({ children }) => (
		<th className="px-3 py-1.5 text-left font-semibold">{children}</th>
	),
	td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
};

interface MarkdownContentProps {
	content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
			{content}
		</ReactMarkdown>
	);
}
