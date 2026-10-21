import {
  PROMPT_REWRITE_MAX_TEXT_LENGTH,
  USER_PROMPT_PLACEHOLDER,
  type PromptRewriteConfig,
  type SystemPromptRewriteMode,
  type UserPromptRewriteMode,
} from "@omniroute/open-sse/services/promptRewrite.ts";

export { PROMPT_REWRITE_MAX_TEXT_LENGTH, USER_PROMPT_PLACEHOLDER };
export type { PromptRewriteConfig };

/** Dashboard form shape for a key's prompt rewrite; "off" means no rule for that prompt. */
export interface PromptRewriteFormState {
  enabled: boolean;
  systemMode: "off" | SystemPromptRewriteMode;
  systemText: string;
  userMode: "off" | UserPromptRewriteMode;
  userText: string;
}

export const DEFAULT_PROMPT_REWRITE_FORM: PromptRewriteFormState = {
  enabled: false,
  systemMode: "off",
  systemText: "",
  userMode: "off",
  userText: "",
};

export function promptRewriteFormFromConfig(
  config: PromptRewriteConfig | null | undefined
): PromptRewriteFormState {
  if (!config) return { ...DEFAULT_PROMPT_REWRITE_FORM };
  return {
    enabled: config.enabled === true,
    systemMode: config.system?.mode ?? "off",
    systemText: config.system?.text ?? "",
    userMode: config.user?.mode ?? "off",
    userText: config.user?.text ?? "",
  };
}

/** The API value for the form: null when nothing is configured (clears the stored rule). */
export function promptRewriteConfigFromForm(
  form: PromptRewriteFormState
): PromptRewriteConfig | null {
  if (!form.enabled && form.systemMode === "off" && form.userMode === "off") return null;
  return {
    enabled: form.enabled,
    system: form.systemMode === "off" ? null : { mode: form.systemMode, text: form.systemText },
    user: form.userMode === "off" ? null : { mode: form.userMode, text: form.userText },
  };
}

/** Validation messages (translation keys) for the form; empty when it can be saved. */
export function validatePromptRewriteForm(form: PromptRewriteFormState): string[] {
  const errors: string[] = [];
  if (
    form.systemText.length > PROMPT_REWRITE_MAX_TEXT_LENGTH ||
    form.userText.length > PROMPT_REWRITE_MAX_TEXT_LENGTH
  ) {
    errors.push("promptRewriteTextTooLong");
  }
  return errors;
}
