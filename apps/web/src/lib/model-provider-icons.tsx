import {
  type SimpleIcon,
  siAnthropic,
  siBaidu,
  siBytedance,
  siClaude,
  siDeepseek,
  siHuggingface,
  siLmstudio,
  siMeta,
  siMistralai,
  siMoonshotai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
  siVllm,
} from "simple-icons";

/** simple-icons only ships Google's monochrome wordmark, not the familiar
 * four-color "G" — render that one from Google's own asset instead. */
const GOOGLE_ICON = "google-multicolor" as const;
type IconEntry = SimpleIcon | typeof GOOGLE_ICON;

/** Keyed by the org/server slug that shows up as the "org/" prefix in a
 * model id (e.g. "google/gemma-4-e4b") or as the local-detect `provider`
 * field (e.g. "lmstudio", "ollama"). Not every provider has a logo
 * (OpenAI, Cohere, Liquid...) — those fall back to a letter avatar. */
const ORG_ICONS: Record<string, IconEntry> = {
  anthropic: siAnthropic,
  claude: siClaude,
  google: GOOGLE_ICON,
  gemini: GOOGLE_ICON,
  gemma: GOOGLE_ICON,
  nvidia: siNvidia,
  nemotron: siNvidia,
  meta: siMeta,
  llama: siMeta,
  mistralai: siMistralai,
  mistral: siMistralai,
  mixtral: siMistralai,
  deepseek: siDeepseek,
  qwen: siQwen,
  huggingface: siHuggingface,
  ollama: siOllama,
  perplexity: siPerplexity,
  moonshotai: siMoonshotai,
  kimi: siMoonshotai,
  baidu: siBaidu,
  bytedance: siBytedance,
  openrouter: siOpenrouter,
  vllm: siVllm,
  lmstudio: siLmstudio,
};

const KEYWORD_ICONS: Array<[RegExp, IconEntry]> = [
  [/claude/, siClaude],
  [/gemini|gemma/, GOOGLE_ICON],
  [/llama/, siMeta],
  [/mistral|mixtral/, siMistralai],
  [/deepseek/, siDeepseek],
  [/qwen/, siQwen],
  [/nemotron/, siNvidia],
  [/kimi|moonshot/, siMoonshotai],
];

/** Google's official four-color "G" glyph — not a brand-icon-set asset,
 * simple-icons/react-icons only carry the flat monochrome wordmark. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Google">
      <title>Google</title>
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
			c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
			c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039
			l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
			c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
			c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}

function stripLabelSuffix(label: string): string {
  // Labels are built as `${modelId} (${providerLabel})` — strip the
  // trailing "(...)" to recover the raw model id for org-prefix matching.
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function resolveModelIcon(model: {
  id: string;
  label: string;
  provider?: string;
}): IconEntry | null {
  const raw = stripLabelSuffix(model.label) || model.id;
  const slashIdx = raw.indexOf("/");
  const orgFromPrefix = slashIdx > 0 ? raw.slice(0, slashIdx).toLowerCase() : null;
  if (orgFromPrefix && ORG_ICONS[orgFromPrefix]) return ORG_ICONS[orgFromPrefix];

  const haystack = raw.toLowerCase();
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(haystack)) return icon;
  }

  const providerKey = model.provider?.toLowerCase();
  if (providerKey && ORG_ICONS[providerKey]) return ORG_ICONS[providerKey];

  return null;
}

/** Per-model avatar: real brand logo when we can resolve one, otherwise the
 * existing gradient letter-circle fallback (using the provider/label initial
 * instead of a hardcoded app-name letter). */
export function ModelAvatar({
  model,
  className = "size-5",
}: {
  model: { id: string; label: string; provider?: string; providerLabel?: string };
  className?: string;
}) {
  const icon = resolveModelIcon(model);

  if (icon === GOOGLE_ICON) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-muted ${className}`}
      >
        <GoogleGlyph className="size-3" />
      </span>
    );
  }

  if (icon) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-muted ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill={`#${icon.hex}`}
          className="size-3"
          role="img"
          aria-label={icon.title}
        >
          <title>{icon.title}</title>
          <path d={icon.path} />
        </svg>
      </span>
    );
  }

  const letter = (model.providerLabel || model.label || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-primary-foreground ${className}`}
      style={{
        backgroundImage: "linear-gradient(135deg, var(--primary), var(--chart-2))",
      }}
    >
      {letter}
    </span>
  );
}
