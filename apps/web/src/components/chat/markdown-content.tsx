"use client";

import "katex/dist/katex.min.css";

import { Check, Copy, WrapText } from "lucide-react";
import { marked } from "marked";
import { createContext, memo, useContext, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { highlightCode } from "@/lib/highlight";

/** True while rendering inside a fenced ``` block. react-markdown v10 removed
 * the `inline` prop from the `code` renderer, so the reliable signal is the
 * surrounding <pre> — the `pre` component below provides this context and the
 * `code` component reads it to tell inline `code` from block code. */
const FencedCodeContext = createContext(false);

/** Fenced code block with a language label, copy button, and a soft-wrap
 * toggle in the header — plus syntax highlighting for registered languages
 * (see lib/highlight.ts), matching a real code editor rather than a plain
 * monochrome <pre>. */
function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const language = /language-([\w+#-]+)/.exec(className ?? "")?.[1] ?? "text";
  const code = String(children).replace(/\n$/, "");
  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);

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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            title={wrap ? "Zeilenumbruch aus" : "Zeilenumbruch an"}
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground ${wrap ? "text-foreground" : ""}`}
          >
            <WrapText className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
      </div>
      <pre
        className={`overflow-x-auto bg-foreground/[0.03] px-4 py-3 text-sm leading-relaxed ${wrap ? "whitespace-pre-wrap break-words" : ""}`}
      >
        {highlighted ? (
          <code
            className="hljs"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: hljs.highlight output over escaped source text, no raw user HTML
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 className="mb-3 mt-5 text-xl font-bold leading-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold leading-tight first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold leading-snug first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h5>,
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-xs font-medium text-muted-foreground first:mt-0">{children}</h6>
  ),

  // Paragraph
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,

  // Lists
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children, ...props }) => {
    // GFM task-list items carry a leading checkbox input — drop the bullet
    // so the checkbox itself is the marker.
    const isTask =
      Array.isArray(children) &&
      children.some(
        (child) =>
          typeof child === "object" &&
          child !== null &&
          "props" in child &&
          (child as { props?: { type?: string } }).props?.type === "checkbox",
      );
    return (
      <li className={`leading-relaxed ${isTask ? "list-none" : ""}`} {...props}>
        {children}
      </li>
    );
  },
  input: ({ checked, disabled }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      disabled={disabled}
      readOnly
      className="mr-1.5 size-3.5 translate-y-0.5 accent-primary"
    />
  ),

  // Inline code vs. fenced code block — react-markdown v10 dropped the
  // `inline` prop, so the `pre` component marks its subtree via context and
  // this renderer branches on it. CodeBlock owns the <pre>.
  code: function Code({ className, children, ...props }) {
    const isFenced = useContext(FencedCodeContext);
    if (!isFenced) {
      return (
        <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },

  // Code block wrapper — the actual <pre> lives inside CodeBlock; this just
  // flags the subtree as fenced for the `code` renderer above.
  pre: ({ children }) => (
    <FencedCodeContext.Provider value={true}>{children}</FencedCodeContext.Provider>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),

  // Emphasis
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

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

  // Images (e.g. model-referenced diagrams or library links)
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      loading="lazy"
      className="mb-2 max-h-96 rounded-xl border border-border/60 object-contain last:mb-0"
    />
  ),

  // Horizontal rule
  hr: () => <hr className="my-3 border-border" />,

  // Table (GFM)
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-border/60 last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-foreground/[0.04]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

/** Models emit LaTeX with \( \) / \[ \] delimiters at least as often as with
 * dollars, but remark-math only understands the dollar forms — normalize
 * before parsing. Fenced code blocks are separate lexer tokens (see
 * splitIntoBlocks) and never reach this. */
function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) => `\n$$\n${expr}\n$$\n`)
    .replace(/\\\((.+?)\\\)/g, (_, expr: string) => `$${expr}$`);
}

function isCodeToken(raw: string): boolean {
  return /^(?:```|~~~|(?: {4}|\t))/.test(raw);
}

/** Splits markdown into stable top-level blocks (via the marked lexer, which
 * keeps lists/tables/fences intact) so streaming only re-parses the last,
 * still-growing block — every earlier block hits the memoized renderer. */
function splitIntoBlocks(content: string): string[] {
  try {
    return marked.lexer(content).map((token) => token.raw);
  } catch {
    return [content];
  }
}

const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
  const normalized = isCodeToken(content) ? content : normalizeMathDelimiters(content);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {normalized}
    </ReactMarkdown>
  );
});

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const blocks = useMemo(() => splitIntoBlocks(content), [content]);
  return (
    <>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only during streaming; index keys keep earlier blocks stable
        <MarkdownBlock key={index} content={block} />
      ))}
    </>
  );
}
