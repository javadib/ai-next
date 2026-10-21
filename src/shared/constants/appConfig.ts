import pkg from "../../../package.json" with { type: "json" };
import { BRAND } from "./brand";

export const APP_CONFIG = {
  name: BRAND.name,
  description: BRAND.description,
  version: pkg.version,
};

export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "system",
};
