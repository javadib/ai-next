import type { Metadata } from "next";
import ComboPlaygroundClient from "./ComboPlaygroundClient";
import { BRAND_NAME } from "@/shared/constants/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Combo Playground`,
  description: "Simulate combo routing paths visually",
};

export default function ComboPlaygroundPage() {
  return <ComboPlaygroundClient />;
}
