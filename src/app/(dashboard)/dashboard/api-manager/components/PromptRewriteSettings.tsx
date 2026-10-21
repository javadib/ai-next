"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Select, Textarea } from "@/shared/components";
import {
  PROMPT_REWRITE_MAX_TEXT_LENGTH,
  USER_PROMPT_PLACEHOLDER,
  type PromptRewriteFormState,
} from "./promptRewriteForm";

const SYSTEM_MODE_OPTIONS = [
  { value: "off", labelKey: "promptRewriteModeOff" },
  { value: "replace", labelKey: "promptRewriteModeReplace" },
  { value: "prepend", labelKey: "promptRewriteModePrepend" },
  { value: "append", labelKey: "promptRewriteModeAppend" },
] as const;

const USER_MODE_OPTIONS = [
  { value: "off", labelKey: "promptRewriteModeOff" },
  { value: "prepend", labelKey: "promptRewriteModePrepend" },
  { value: "append", labelKey: "promptRewriteModeAppend" },
  { value: "template", labelKey: "promptRewriteModeTemplate" },
] as const;

/**
 * Per-key prompt rewrite editor: the gateway rewrites the System Prompt and/or the last
 * User Prompt of every chat request made with this key before it reaches the model.
 * Controlled — the caller owns the state (access editor tab and create-key modal).
 */
export function PromptRewriteSettings({
  value,
  onChange,
}: {
  value: PromptRewriteFormState;
  onChange: (next: PromptRewriteFormState) => void;
}) {
  const t = useTranslations("apiManager");
  const tc = useTranslations("common");
  const systemTextId = useId();
  const userTextId = useId();
  const set = (patch: Partial<PromptRewriteFormState>) => onChange({ ...value, ...patch });
  const templateMissingPlaceholder =
    value.userMode === "template" &&
    value.userText.trim().length > 0 &&
    !value.userText.includes(USER_PROMPT_PLACEHOLDER);

  return (
    <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-surface/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("promptRewriteTitle")}</p>
          <p className="text-xs text-text-muted">{t("promptRewriteDesc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          aria-label={t("promptRewriteTitle")}
          onClick={() => set({ enabled: !value.enabled })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${
            value.enabled
              ? "bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">edit_note</span>
          {value.enabled ? tc("enabled") : tc("disabled")}
        </button>
      </div>

      <div className={`flex flex-col gap-4 ${value.enabled ? "" : "opacity-60"}`}>
        <div className="flex flex-col gap-2">
          <Select
            compact
            label={t("promptRewriteSystemPrompt")}
            value={value.systemMode}
            onChange={(e) =>
              set({ systemMode: e.target.value as PromptRewriteFormState["systemMode"] })
            }
            options={SYSTEM_MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          />
          {value.systemMode !== "off" && (
            <>
              <label htmlFor={systemTextId} className="sr-only">
                {t("promptRewriteSystemPrompt")}
              </label>
              <Textarea
                id={systemTextId}
                rows={4}
                maxLength={PROMPT_REWRITE_MAX_TEXT_LENGTH}
                value={value.systemText}
                onChange={(e) => set({ systemText: e.target.value })}
                placeholder={t("promptRewriteSystemPlaceholder")}
              />
            </>
          )}
          <p className="text-xs text-text-muted">{t("promptRewriteSystemHelp")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Select
            compact
            label={t("promptRewriteUserPrompt")}
            value={value.userMode}
            onChange={(e) =>
              set({ userMode: e.target.value as PromptRewriteFormState["userMode"] })
            }
            options={USER_MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          />
          {value.userMode !== "off" && (
            <>
              <label htmlFor={userTextId} className="sr-only">
                {t("promptRewriteUserPrompt")}
              </label>
              <Textarea
                id={userTextId}
                rows={4}
                maxLength={PROMPT_REWRITE_MAX_TEXT_LENGTH}
                value={value.userText}
                onChange={(e) => set({ userText: e.target.value })}
                placeholder={t("promptRewriteUserPlaceholder", {
                  placeholder: USER_PROMPT_PLACEHOLDER,
                })}
              />
            </>
          )}
          <p className="text-xs text-text-muted">
            {t("promptRewriteUserHelp", { placeholder: USER_PROMPT_PLACEHOLDER })}
          </p>
          {templateMissingPlaceholder && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t("promptRewriteTemplateMissingPlaceholder", {
                placeholder: USER_PROMPT_PLACEHOLDER,
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
