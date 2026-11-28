// Links to the Kabine documentation on kabine.dev, which is built from the module READMEs in the repository
// (site/src/docs.mjs). The app shows them as plain links in a new tab (DocsLink in src/ui.tsx) and loads nothing
// from there; they are the project's documentation, never a club's legal pages.
import type { Locale } from "./i18n";

const SITE = "https://kabine.dev";

/**
 * Headings of module pages the app links to (anchors as site/src/docs.mjs makes them). test/site-docs.test.ts checks
 * that the READMEs of these modules have them; `"fixtures"` means every game schedule source.
 */
export const DOC_SECTIONS: Record<string, { modules: string[] | "fixtures"; en: string; de: string }> = {
  mascotGuide: { modules: ["mascot"], en: "preparing-the-pictures", de: "bilder-vorbereiten" },
  /** Where a coach finds the team's link at the source and where it goes. */
  scheduleLink: { modules: "fixtures", en: "linking-a-team", de: "link-der-mannschaft" },
  /** How and how often the source syncs. */
  scheduleSync: { modules: ["handball4all", "handballnet"], en: "how-the-sync-works", de: "so-funktioniert-der-abgleich" },
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
