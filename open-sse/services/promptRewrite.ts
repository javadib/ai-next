/**
 * Per-API-key prompt rewrite — pure request transformer (no DB, no I/O).
 *
 * An operator can attach a rewrite rule to an API key so the gateway edits the
 * System Prompt and/or the last User Prompt of every chat request made with that
 * key before it is translated and dispatched upstream. The config is stored as a
 * JSON column on `api_keys` (`prompt_rewrite`) and validated by
 * `promptRewriteConfigSchema` both at the management API and on read.
 *
 * Supported client formats (the body as the client sent it, BEFORE translation):
 *   - OpenAI Chat Completions — `messages[]` with system/developer/user roles,
 *     content as a string or an array of parts (only `text` parts are touched).
 *   - Anthropic Messages — top-level `system` (string or text blocks) and
 *     `messages[]` with string or block content.
 *   - OpenAI Responses — `instructions` + `input` (string or item array).
 * Any other shape (Gemini `contents`, Antigravity envelopes, …) is returned untouched.
 */

import { z } from "zod";

/** Upper bound for each rewrite text, enforced by the schema. */
export const PROMPT_REWRITE_MAX_TEXT_LENGTH = 20_000;

/** Placeholder substituted with the original last-user-message text in `template` mode. */
export const USER_PROMPT_PLACEHOLDER = "{{user_prompt}}";

export const SYSTEM_PROMPT_REWRITE_MODES = ["replace", "prepend", "append"] as const;
export const USER_PROMPT_REWRITE_MODES = ["prepend", "append", "template"] as const;

export type SystemPromptRewriteMode = (typeof SYSTEM_PROMPT_REWRITE_MODES)[number];
export type UserPromptRewriteMode = (typeof USER_PROMPT_REWRITE_MODES)[number];

const rewriteText = z.string().max(PROMPT_REWRITE_MAX_TEXT_LENGTH);

export const systemPromptRuleSchema = z.object({
  mode: z.enum(SYSTEM_PROMPT_REWRITE_MODES),
  text: rewriteText,
});

export const userPromptRuleSchema = z.object({
  mode: z.enum(USER_PROMPT_REWRITE_MODES),
  text: rewriteText,
});

/**
 * Stored/accepted shape. Unknown keys are stripped (not rejected) so a newer writer's
 * extra fields never make an older reader drop the whole rule.
 */
export const promptRewriteConfigSchema = z.object({
  enabled: z.boolean(),
  system: systemPromptRuleSchema.nullable().optional(),
  user: userPromptRuleSchema.nullable().optional(),
});

export type SystemPromptRule = z.infer<typeof systemPromptRuleSchema>;
export type UserPromptRule = z.infer<typeof userPromptRuleSchema>;
export type PromptRewriteConfig = z.infer<typeof promptRewriteConfigSchema>;

export type PromptRewriteFormat = "openai" | "claude" | "openai-responses";

export interface PromptRewriteResult<T = unknown> {
  body: T;
  systemApplied: boolean;
  userApplied: boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse a stored column value (JSON text) or an already-decoded object. Anything that
 * does not satisfy the schema yields `null` — a corrupt row disables the rewrite instead
 * of failing the request.
 */
export function parsePromptRewriteConfig(raw: unknown): PromptRewriteConfig | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = promptRewriteConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function activeSystemRule(config: PromptRewriteConfig): SystemPromptRule | null {
  const rule = config.system;
  return rule && rule.text.trim().length > 0 ? rule : null;
}

function activeUserRule(config: PromptRewriteConfig): UserPromptRule | null {
  const rule = config.user;
  return rule && rule.text.trim().length > 0 ? rule : null;
}

/** True when the config is enabled and has at least one rule with non-blank text. */
export function isPromptRewriteActive(
  config: PromptRewriteConfig | null | undefined
): config is PromptRewriteConfig {
  if (!config || config.enabled !== true) return false;
  return activeSystemRule(config) !== null || activeUserRule(config) !== null;
}

// ──── Text helpers ────

const JOINER = "\n\n";

function combine(mode: "prepend" | "append", original: string, text: string): string {
  if (!original) return text;
  return mode === "prepend" ? `${text}${JOINER}${original}` : `${original}${JOINER}${text}`;
}

/** Literal substitution — never `String.replace` (its `$&`/`$1` patterns would corrupt input). */
function fillTemplate(template: string, original: string): string {
  return template.split(USER_PROMPT_PLACEHOLDER).join(original);
}

const TEXT_PART_TYPES = new Set(["text", "input_text"]);

function isTextPart(part: unknown): part is JsonRecord & { text: string } {
  return (
    isRecord(part) &&
    typeof part.type === "string" &&
    TEXT_PART_TYPES.has(part.type) &&
    typeof part.text === "string"
  );
}

/**
 * Rewrite message content (string or parts array). Only text parts change; every other
 * part (images, audio, files, tool results, cache_control markers on other blocks) keeps
 * its identity and position. Returns `undefined` when the content is not rewritable.
 */
function rewriteContent(
  content: unknown,
  rule: { mode: "prepend" | "append" | "template"; text: string },
  newPartType: "text" | "input_text"
): unknown {
  if (typeof content === "string") {
    return rule.mode === "template"
      ? fillTemplate(rule.text, content)
      : combine(rule.mode, content, rule.text);
  }
  if (content === null || content === undefined) {
    return rule.mode === "template" ? fillTemplate(rule.text, "") : rule.text;
  }
  if (!Array.isArray(content)) return undefined;

  const textIndexes: number[] = [];
  content.forEach((part, index) => {
    if (isTextPart(part)) textIndexes.push(index);
  });

  if (textIndexes.length === 0) {
    const value = rule.mode === "template" ? fillTemplate(rule.text, "") : rule.text;
    const newPart = { type: newPartType, text: value };
    return rule.mode === "prepend" ? [newPart, ...content] : [...content, newPart];
  }

  if (rule.mode === "template") {
    const original = textIndexes.map((i) => (content[i] as { text: string }).text).join("\n");
    const first = textIndexes[0];
    const dropped = new Set(textIndexes.slice(1));
    return content
      .map((part, index) =>
        index === first
          ? { ...(part as JsonRecord), text: fillTemplate(rule.text, original) }
          : part
      )
      .filter((_part, index) => !dropped.has(index));
  }

  const target = rule.mode === "prepend" ? textIndexes[0] : textIndexes[textIndexes.length - 1];
  return content.map((part, index) => {
    if (index !== target) return part;
    const textPart = part as JsonRecord & { text: string };
    return {
      ...textPart,
      text: combine(rule.mode as "prepend" | "append", textPart.text, rule.text),
    };
  });
}

function containsToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) && content.some((part) => isRecord(part) && part.type === "tool_result")
  );
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

/**
 * Apply the user rule to the last user message of a message list. A Claude user turn that
 * only carries tool results (agent loops) is skipped: injecting operator text into every
 * tool round would change the conversation, and the real user prompt is an earlier turn.
 */
function rewriteLastUserMessage(
  messages: unknown[],
  rule: UserPromptRule,
  newPartType: "text" | "input_text",
  isUserMessage: (message: JsonRecord) => boolean
): unknown[] | null {
  const index = lastIndexWhere(messages, (m) => isRecord(m) && isUserMessage(m));
  if (index < 0) return null;
  const message = messages[index] as JsonRecord;
  const content = message.content;
  if (Array.isArray(content) && !content.some(isTextPart) && containsToolResult(content)) {
    return null;
  }
  const next = rewriteContent(content, rule, newPartType);
  if (next === undefined) return null;
  const copy = [...messages];
  copy[index] = { ...message, content: next };
  return copy;
}

// ──── OpenAI Chat Completions ────

const OPENAI_SYSTEM_ROLES = new Set(["system", "developer"]);

function isOpenAiSystemMessage(message: unknown): message is JsonRecord {
  return (
    isRecord(message) && typeof message.role === "string" && OPENAI_SYSTEM_ROLES.has(message.role)
  );
}

function rewriteOpenAiSystem(messages: unknown[], rule: SystemPromptRule): unknown[] {
  const systemIndexes: number[] = [];
  messages.forEach((m, i) => {
    if (isOpenAiSystemMessage(m)) systemIndexes.push(i);
  });

  if (rule.mode === "replace") {
    const firstRole =
      systemIndexes.length > 0 ? (messages[systemIndexes[0]] as JsonRecord).role : "system";
    const rest = messages.filter((m) => !isOpenAiSystemMessage(m));
    return [{ role: firstRole, content: rule.text }, ...rest];
  }
  if (systemIndexes.length === 0) {
    return [{ role: "system", content: rule.text }, ...messages];
  }

  const target =
    rule.mode === "prepend" ? systemIndexes[0] : systemIndexes[systemIndexes.length - 1];
  const message = messages[target] as JsonRecord;
  const next = rewriteContent(message.content, { mode: rule.mode, text: rule.text }, "text");
  if (next === undefined) {
    // Unrecognised content shape: add a dedicated message rather than corrupt it.
    const added = { role: "system", content: rule.text };
    return rule.mode === "prepend"
      ? [...messages.slice(0, target), added, ...messages.slice(target)]
      : [...messages.slice(0, target + 1), added, ...messages.slice(target + 1)];
  }
  const copy = [...messages];
  copy[target] = { ...message, content: next };
  return copy;
}

function applyOpenAi(
  body: JsonRecord,
  system: SystemPromptRule | null,
  user: UserPromptRule | null
): PromptRewriteResult<JsonRecord> {
  if (!Array.isArray(body.messages)) return { body, systemApplied: false, userApplied: false };
  let messages: unknown[] = body.messages;
  let systemApplied = false;
  let userApplied = false;

  if (user) {
    const next = rewriteLastUserMessage(messages, user, "text", (m) => m.role === "user");
    if (next) {
      messages = next;
      userApplied = true;
    }
  }
  if (system) {
    messages = rewriteOpenAiSystem(messages, system);
    systemApplied = true;
  }
  return {
    body: systemApplied || userApplied ? { ...body, messages } : body,
    systemApplied,
    userApplied,
  };
}

// ──── Anthropic Messages ────

function rewriteClaudeSystem(system: unknown, rule: SystemPromptRule): unknown {
  if (rule.mode === "replace") return rule.text;
  if (system === undefined || system === null || system === "") return rule.text;
  if (typeof system === "string") return combine(rule.mode, system, rule.text);
  if (Array.isArray(system)) {
    const block = { type: "text", text: rule.text };
    return rule.mode === "prepend" ? [block, ...system] : [...system, block];
  }
  return rule.text;
}

function applyClaude(
  body: JsonRecord,
  system: SystemPromptRule | null,
  user: UserPromptRule | null
): PromptRewriteResult<JsonRecord> {
  let next: JsonRecord = body;
  let systemApplied = false;
  let userApplied = false;

  if (user && Array.isArray(body.messages)) {
    const messages = rewriteLastUserMessage(body.messages, user, "text", (m) => m.role === "user");
    if (messages) {
      next = { ...next, messages };
      userApplied = true;
    }
  }
  if (system) {
    next = { ...next, system: rewriteClaudeSystem(body.system, system) };
    systemApplied = true;
  }
  return { body: next, systemApplied, userApplied };
}

// ──── OpenAI Responses ────

function isResponsesUserItem(item: JsonRecord): boolean {
  return item.role === "user" && (item.type === undefined || item.type === "message");
}

function isResponsesSystemItem(item: unknown): boolean {
  return (
    isRecord(item) &&
    (item.role === "system" || item.role === "developer") &&
    (item.type === undefined || item.type === "message")
  );
}

function applyResponses(
  body: JsonRecord,
  system: SystemPromptRule | null,
  user: UserPromptRule | null
): PromptRewriteResult<JsonRecord> {
  let next: JsonRecord = body;
  let systemApplied = false;
  let userApplied = false;

  if (user) {
    if (typeof body.input === "string") {
      next = { ...next, input: rewriteContent(body.input, user, "input_text") };
      userApplied = true;
    } else if (Array.isArray(body.input)) {
      const input = rewriteLastUserMessage(body.input, user, "input_text", isResponsesUserItem);
      if (input) {
        next = { ...next, input };
        userApplied = true;
      }
    }
  }

  if (system) {
    const current = typeof body.instructions === "string" ? body.instructions : "";
    if (system.mode === "replace") {
      next = { ...next, instructions: system.text };
      if (Array.isArray(next.input)) {
        next = {
          ...next,
          input: (next.input as unknown[]).filter((i) => !isResponsesSystemItem(i)),
        };
      }
    } else {
      next = { ...next, instructions: combine(system.mode, current, system.text) };
    }
    systemApplied = true;
  }

  return { body: next, systemApplied, userApplied };
}

// ──── Entry point ────

/** Resolve which client format a body is in, preferring the caller's endpoint-derived hint. */
export function resolvePromptRewriteFormat(
  body: JsonRecord,
  sourceFormat?: string | null
): PromptRewriteFormat | null {
  if (sourceFormat === "openai-responses") return "openai-responses";
  if (sourceFormat === "claude") return "claude";
  if (sourceFormat === "openai") return Array.isArray(body.messages) ? "openai" : null;
  if (sourceFormat) return null;
  if (body.input !== undefined || typeof body.instructions === "string") return "openai-responses";
  if (Array.isArray(body.messages)) return body.system !== undefined ? "claude" : "openai";
  return null;
}

/**
 * Apply a key's rewrite config to a request body. Pure: the input body is never mutated;
 * a shallow-copied body is returned when anything changed. An inactive config, an
 * unsupported format or a non-object body is returned as-is.
 */
export function applyPromptRewrite<T = unknown>(
  body: T,
  config: PromptRewriteConfig | null | undefined,
  sourceFormat?: string | null
): PromptRewriteResult<T> {
  const untouched = { body, systemApplied: false, userApplied: false };
  if (!isPromptRewriteActive(config) || !isRecord(body)) return untouched;

  const format = resolvePromptRewriteFormat(body, sourceFormat);
  if (!format) return untouched;

  const system = activeSystemRule(config);
  const user = activeUserRule(config);
  const result =
    format === "openai"
      ? applyOpenAi(body, system, user)
      : format === "claude"
        ? applyClaude(body, system, user)
        : applyResponses(body, system, user);
  return result as PromptRewriteResult<T>;
}
