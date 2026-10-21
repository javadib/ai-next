/**
 * White-label brand configuration.
 *
 * Everything the end user sees as the product name goes through `BRAND`. Internal identifiers
 * (package name, CLI binary, env vars, `x-omniroute-*` headers, DB keys) intentionally keep
 * the upstream name so existing installs, clients and upstream merges keep working.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time — rebuild after changing them.
 */

/** Name used by the upstream codebase and its translation files. */
export const UPSTREAM_BRAND_NAME = "OmniRoute";

function readEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export const BRAND = {
  name: readEnv(process.env.NEXT_PUBLIC_BRAND_NAME) || "AI Next",
  description: "AI Gateway for Multi-Provider LLMs",
  /** Show links, banners and remote feeds that point at the upstream open-source project. */
  showUpstreamLinks: readEnv(process.env.NEXT_PUBLIC_SHOW_UPSTREAM_LINKS) === "true",
  /** Optional public docs URL; links to docs are hidden when empty. */
  docsUrl: readEnv(process.env.NEXT_PUBLIC_BRAND_DOCS_URL),
  /** Optional support / contact URL; support links are hidden when empty. */
  supportUrl: readEnv(process.env.NEXT_PUBLIC_BRAND_SUPPORT_URL),
} as const;

export const BRAND_NAME = BRAND.name;

/** Up to two initials used by the placeholder monogram logo ("AI Next" → "AN"). */
export function brandInitials(name: string = BRAND.name): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
      : (words[0] || "").slice(0, 2);
  return initials.toUpperCase();
}

/**
 * Matches the upstream product name as a standalone word only — never inside identifiers,
 * headers or URLs (`X-OmniRoute-No-Cache`, `custom:OmniRoute-0`, `/OmniRoute/`, `usingOmniRoute`).
 */
const UPSTREAM_NAME_RE = /(?<![\w/@.:-])OmniRoute(?![\w-])/g;

/** Replace the upstream product name with the configured brand name in display text. */
export function applyBrand(text: string, brandName: string = BRAND.name): string {
  if (!text || brandName === UPSTREAM_BRAND_NAME) return text;
  return text.replace(UPSTREAM_NAME_RE, brandName);
}

/** Deep-apply {@link applyBrand} to every string leaf of a translation messages tree. */
export function applyBrandToMessages<T>(messages: T, brandName: string = BRAND.name): T {
  if (brandName === UPSTREAM_BRAND_NAME) return messages;
  if (typeof messages === "string") return applyBrand(messages, brandName) as T;
  if (Array.isArray(messages)) {
    return messages.map((item) => applyBrandToMessages(item, brandName)) as T;
  }
  if (messages && typeof messages === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
      out[key] = applyBrandToMessages(value, brandName);
    }
    return out as T;
  }
  return messages;
}
