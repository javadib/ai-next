"use client";

import { PromptRewriteSettings } from "@/app/(dashboard)/dashboard/api-manager/components/PromptRewriteSettings";
import type { PromptRewriteFormState } from "@/app/(dashboard)/dashboard/api-manager/components/promptRewriteForm";
import type { ApiKeyAccessFormState } from "../useApiKeyAccessForm";
import TabErrorList from "./TabErrorList";

interface PromptRewriteTabProps {
  formState: ApiKeyAccessFormState;
  setPromptRewrite: (next: PromptRewriteFormState) => void;
  errors?: string[];
}

export default function PromptRewriteTab({
  formState,
  setPromptRewrite,
  errors,
}: PromptRewriteTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <TabErrorList errors={errors} />
      <PromptRewriteSettings value={formState.promptRewrite} onChange={setPromptRewrite} />
    </div>
  );
}
