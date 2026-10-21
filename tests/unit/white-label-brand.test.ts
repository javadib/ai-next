import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import {
  applyBrand,
  applyBrandToMessages,
  brandInitials,
  UPSTREAM_BRAND_NAME,
} from "../../src/shared/constants/brand.ts";

test("applyBrand swaps the standalone product name", () => {
  assert.equal(applyBrand("Loading OmniRoute...", "AI Next"), "Loading AI Next...");
  assert.equal(applyBrand("OmniRoute's router", "AI Next"), "AI Next's router");
  assert.equal(applyBrand("OmniRoute — OmniRoute", "AI Next"), "AI Next — AI Next");
});

test("applyBrand leaves identifiers, headers and URLs untouched", () => {
  for (const text of [
    "X-OmniRoute-No-Cache: true",
    "custom:OmniRoute-0",
    "https://github.com/diegosouzapw/OmniRoute/issues",
    "@omniroute/open-sse",
    "usingOmniRoute",
    "OmniRouteLogo",
    "sk_omniroute",
  ]) {
    assert.equal(applyBrand(text, "AI Next"), text);
  }
});

test("applyBrand renames upstream feature names for display", () => {
  assert.equal(applyBrand("OmniProxy", "AI Next"), "Gateway");
  assert.equal(applyBrand("Enable the OmniGlyph engine", "AI Next"), "Enable the GlyphPack engine");
  assert.equal(applyBrand("OmniSkills", "AI Next"), "NextSkills");
  assert.equal(applyBrand("Omni Skills — Inbound", "AI Next"), "Next Skills — Inbound");
  assert.equal(applyBrand("OmniConductor hub", "AI Next"), "Conductor Hub hub");
  assert.equal(applyBrand("Combo Studio", "AI Next"), "Route Studio");
  assert.equal(applyBrand("Embedded Services", "AI Next"), "Built-in Services");
  assert.equal(
    applyBrand("you → CLI → Omni → provider", "AI Next"),
    "you → CLI → AI Next → provider"
  );
  assert.equal(applyBrand("official Omniroute registry", "AI Next"), "official AI Next registry");
  // Real third-party product names and identifiers are left alone.
  assert.equal(applyBrand("OmniCopilot", "AI Next"), "OmniCopilot");
  assert.equal(applyBrand("/dashboard/omni-skills", "AI Next"), "/dashboard/omni-skills");
});

test("applyBrand is a no-op when the brand is the upstream name", () => {
  assert.equal(applyBrand("OmniRoute", UPSTREAM_BRAND_NAME), "OmniRoute");
  assert.equal(applyBrand("OmniProxy", UPSTREAM_BRAND_NAME), "OmniProxy");
});

test("applyBrandToMessages rewrites every string leaf and keeps the shape", () => {
  const messages = {
    common: { title: "OmniRoute", count: 3 },
    list: ["Use OmniRoute", "plain"],
    header: "X-OmniRoute-Model",
  };
  assert.deepEqual(applyBrandToMessages(messages, "AI Next"), {
    common: { title: "AI Next", count: 3 },
    list: ["Use AI Next", "plain"],
    header: "X-OmniRoute-Model",
  });
  assert.equal(messages.common.title, "OmniRoute", "input is not mutated");
});

test("brandInitials builds the monogram", () => {
  assert.equal(brandInitials("AI Next"), "AN");
  assert.equal(brandInitials("Gateway"), "GA");
  assert.equal(brandInitials("  my  cool  app "), "MC");
});

test("white-label defaults: AI Next name, upstream links and sponsors hidden", () => {
  // The suite runs in upstream mode (tests/_setup/upstreamBrandMode.ts); check the real
  // defaults in a child process with the brand env vars removed.
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_BRAND_NAME;
  delete env.NEXT_PUBLIC_SHOW_UPSTREAM_LINKS;
  delete env.NEXT_PUBLIC_BRAND_SUPPORT_URL;
  delete env.NEXT_PUBLIC_BRAND_DOCS_URL;

  const script = `
    const { BRAND } = await import("./src/shared/constants/brand.ts");
    const { APP_CONFIG } = await import("./src/shared/constants/appConfig.ts");
    const featured = await import("./src/app/(dashboard)/dashboard/providers/featuredProviders.ts");
    const { SIDEBAR_SECTIONS } = await import("./src/shared/constants/sidebarVisibility/sections.ts");
    const help = SIDEBAR_SECTIONS.find((s) => s.id === "help");
    console.log(JSON.stringify({
      name: BRAND.name,
      appName: APP_CONFIG.name,
      showUpstreamLinks: BRAND.showUpstreamLinks,
      kimiFeatured: featured.isFeaturedProviderId("kimi"),
      kimiPartner: featured.isKimiPartnerProviderId("kimi"),
      helpIds: help.children.map((c) => c.id),
      helpHrefs: help.children.map((c) => c.href),
    }));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "-e", script],
    { env, cwd: process.cwd(), encoding: "utf8" }
  );
  const result = JSON.parse(out.trim().split("\n").pop() as string);

  assert.equal(result.name, "AI Next");
  assert.equal(result.appName, "AI Next");
  assert.equal(result.showUpstreamLinks, false);
  assert.equal(result.kimiFeatured, false);
  assert.equal(result.kimiPartner, false);
  assert.deepEqual(result.helpIds, ["docs"]);
  assert.ok(
    result.helpHrefs.every((href: string) => !href.includes("github.com")),
    "no upstream GitHub link in the Help section"
  );
});
