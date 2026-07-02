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
/** simple-icons dropped OpenAI's mark (trademark takedown), so render the
 * logomark from a hardcoded path instead of falling back to a letter. */
const OPENAI_ICON = "openai-mark" as const;
type IconEntry = SimpleIcon | typeof GOOGLE_ICON | typeof OPENAI_ICON;

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
  openai: OPENAI_ICON,
  codex: OPENAI_ICON,
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
  [/^gpt-|^o[0-9]|gpt-image|codex/, OPENAI_ICON],
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

/** OpenAI's logomark — simple-icons pulled it after a trademark dispute, so
 * it's hardcoded here the same way GOOGLE_ICON is. */
function OpenAiGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" fill="currentColor">
      <title>OpenAI</title>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.7948.7948 0 0 0-.4069-.6765zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.4592a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
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
  providerLabel?: string;
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

  // Manually-installed "openai_compatible" providers keep that generic
  // providerKind slug (doesn't match any ORG_ICONS key) but carry a
  // human-facing label — either user-typed or a runtime default like
  // "LM Studio" — that does. This is often the only signal left once the
  // model id itself is opaque (e.g. an embeddings model with no
  // recognizable org prefix or keyword).
  const providerLabelKey = model.providerLabel?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (providerLabelKey) {
    for (const [key, icon] of Object.entries(ORG_ICONS)) {
      if (providerLabelKey.includes(key)) return icon;
    }
  }

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

  if (icon === OPENAI_ICON) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground ${className}`}
      >
        <OpenAiGlyph className="size-3" />
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
