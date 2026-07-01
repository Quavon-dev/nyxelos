import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

	// Inline code
	// biome-ignore lint/suspicious/noExplicitAny: react-markdown node typing
	code: ({ inline, children, ...props }: any) => {
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
		return (
			<code className="block font-mono text-[0.85em]" {...props}>
				{children}
			</code>
		);
	},

	// Code block
	pre: ({ children }) => (
		<pre className="mb-3 overflow-x-auto rounded-xl bg-foreground/8 px-4 py-3 text-sm leading-relaxed last:mb-0">
			{children}
		</pre>
	),

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
