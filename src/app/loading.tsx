"use client";

import { PageLoading } from "@/shared/components/Loading";
import { BRAND_NAME } from "@/shared/constants/brand";

export default function AppLoading() {
  return <PageLoading message={`Loading ${BRAND_NAME}...`} />;
}
