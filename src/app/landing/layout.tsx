import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BRAND } from "@/shared/constants/brand";

// White-label: the landing page markets the upstream open-source project.
export default function LandingLayout({ children }: { children: ReactNode }) {
  if (!BRAND.showUpstreamLinks) redirect("/dashboard");
  return children;
}
