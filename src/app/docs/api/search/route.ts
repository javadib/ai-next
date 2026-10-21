import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";
import { BRAND } from "@/shared/constants/brand";

const upstreamSearch = createFromSource(source);

// White-label: the indexed guides describe the upstream project, so search returns nothing.
export const GET = BRAND.showUpstreamLinks ? upstreamSearch.GET : () => Response.json([]);
