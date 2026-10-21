import ConductorPageClient from "./ConductorPageClient";
import { BRAND_NAME } from "@/shared/constants/brand";

export const metadata = {
  title: `Conductor — ${BRAND_NAME}`,
  description: "OmniConductor CLI-agent fleet: runners, task queue and councils, live.",
};

export default function ConductorPage() {
  return <ConductorPageClient />;
}
