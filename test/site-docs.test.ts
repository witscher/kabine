// The module pages on kabine.dev are built from the READMEs (site/src/docs.mjs) and the app links to them
// (shared/site-docs.ts): every module needs both READMEs, and the headings the app links to must exist.
import { describe, expect, it } from "vitest";
import { MODULES } from "../shared/modules";
import { DOC_SECTIONS, moduleDocsSlug, moduleDocsUrl } from "../shared/site-docs";

const manifests = import.meta.glob("../modules/*/module.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const readmes = import.meta.glob("../modules/*/README*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The same anchor as the site's headings (site/src/docs.mjs, slug). */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
const anchors = (md: string) => [...md.matchAll(/^#{2,6} (.+)$/gm)].map(([, h]) => slug(h!.replace(/[*_`]/g, "")));

describe("module documentation", () => {
  it("every module has README.md and README.de.md, each with a title", () => {
    const folders = Object.keys(manifests).map((p) => p.split("/")[2]!);
    expect(folders.length).toBe(MODULES.length);
    for (const folder of folders) {
      for (const file of ["README.md", "README.de.md"]) {
        const md = readmes[`../modules/${folder}/${file}`];
        expect(md, `modules/${folder}/${file}`).toBeTypeOf("string");
        expect(md, `modules/${folder}/${file}: title`).toMatch(/^# \S/m);
      }
    }
  });

  it("the headings the app links to exist in both languages", () => {
    const fixtures = Object.entries(manifests)
      .filter(([, src]) => /\bkind: "fixtures"/.test(src))
      .map(([p]) => p.split("/")[2]!);
    expect(fixtures).toContain("handball4all");
    for (const { modules, en, de } of Object.values(DOC_SECTIONS)) {
      for (const module of modules === "fixtures" ? fixtures : modules) {
        expect(anchors(readmes[`../modules/${module}/README.md`]!), `${module}: ${en}`).toContain(en);
        expect(anchors(readmes[`../modules/${module}/README.de.md`]!), `${module}: ${de}`).toContain(de);
      }
    }
  });

  it("page paths are the module ids in kebab case", () => {
    expect(moduleDocsSlug("handball4all")).toBe("handball4all");
    expect(moduleDocsSlug("matchReports")).toBe("match-reports");
    expect(moduleDocsUrl("mascot", "de", DOC_SECTIONS.mascotGuide)).toBe("https://kabine.dev/docs/module/mascot/#bilder-vorbereiten");
    expect(moduleDocsUrl("handballnet", "en")).toBe("https://kabine.dev/en/docs/modules/handballnet/");
  });
});
