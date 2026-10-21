/**
 * /dashboard/chaos/page.tsx — Chaos Mode Configuration
 */
import { getTranslations } from "next-intl/server";
import ChaosConfigPageClient from "./ChaosConfigPageClient";
import { BRAND_NAME } from "@/shared/constants/brand";

export async function generateMetadata() {
  const t = await getTranslations("chaosConfig");
  return { title: `${t("pageTitle")} — ${BRAND_NAME}` };
}

export default function Page() {
  return <ChaosConfigPageClient />;
}
