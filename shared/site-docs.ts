// Links to the Kabine documentation on kabine.dev, which is built from the module READMEs in the repository
// (site/src/docs.mjs). The app shows them as plain links in a new tab (DocsLink in src/ui.tsx) and loads nothing
// from there; they are the project's documentation, never a club's legal pages.
import type { Locale } from "./i18n";

const SITE = "https://kabine.dev";

/** Headings of module pages the app links to (anchors as site/src/docs.mjs makes them; test/site-docs.test.ts checks them). */
export const DOC_SECTIONS: Record<string, { module: string; en: string; de: string }> = {
  mascotGuide: { module: "mascot", en: "preparing-the-pictures", de: "bilder-vorbereiten" },
};

/** Path segment of a module's page: its id in kebab case (the folder name, site/src/docs.mjs). */
export const moduleDocsSlug = (id: string) => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The module's page on kabine.dev, German or English, optionally at one of its headings. */
export function moduleDocsUrl(id: string, locale: Locale, section?: { en: string; de: string }): string {
  const de = locale === "de";
  const path = de ? `/docs/module/${moduleDocsSlug(id)}/` : `/en/docs/modules/${moduleDocsSlug(id)}/`;
  return `${SITE}${path}${section ? `#${de ? section.de : section.en}` : ""}`;
}

/** The overview of all modules on kabine.dev. */
export function modulesOverviewUrl(locale: Locale): string {
  return locale === "de" ? `${SITE}/docs/#module` : `${SITE}/en/docs/#modules`;
}
