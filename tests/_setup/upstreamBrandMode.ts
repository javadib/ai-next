// White-label fork: the upstream test suite asserts upstream branding, sponsor placement and
// links, so it runs in "upstream mode" by default (brand name OmniRoute, upstream links on).
// The white-label defaults (AI Next, upstream links off) are covered in a child process by
// tests/unit/white-label-brand.test.ts. Explicitly set env vars keep winning.
process.env.NEXT_PUBLIC_BRAND_NAME ||= "OmniRoute";
process.env.NEXT_PUBLIC_SHOW_UPSTREAM_LINKS ||= "true";
