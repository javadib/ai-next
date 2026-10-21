import {
  applyPromptRewrite,
  isPromptRewriteActive,
  type PromptRewriteConfig,
} from "@omniroute/open-sse/services/promptRewrite.ts";

type PromptRewriteLogger = {
  debug?: (tag: string, msg: string, meta?: Record<string, unknown>) => void;
};

type PromptRewriteKeyInfo = {
  id?: string | null;
  promptRewrite?: PromptRewriteConfig | null;
} | null;

/**
 * Apply the presented API key's prompt-rewrite rule to the client request body.
 *
 * Called once per incoming request in `handleChat`, after API-key policy enforcement and
 * the pre-call guardrails and before routing / combo fan-out, so every combo target and
 * retry sees the same rewritten prompt (never rewritten twice). Internal self-loop
 * sub-requests present the synthetic self-loop key, which has no rule.
 *
 * The prompt text itself is never logged — only which parts were rewritten.
 */
export function applyApiKeyPromptRewrite<T>(
  body: T,
  apiKeyInfo: PromptRewriteKeyInfo | undefined,
  sourceFormat: string | null | undefined,
  log?: PromptRewriteLogger
): T {
  const config = apiKeyInfo?.promptRewrite;
  if (!isPromptRewriteActive(config)) return body;
  const result = applyPromptRewrite(body, config, sourceFormat);
  if (result.systemApplied || result.userApplied) {
    log?.debug?.("PROMPT_REWRITE", "Applied per-key prompt rewrite", {
      apiKeyId: apiKeyInfo?.id ?? null,
      sourceFormat: sourceFormat ?? null,
      system: result.systemApplied,
      user: result.userApplied,
    });
  }
  return result.body;
}
