// The documentation the chatbot of kabine.dev may answer from, built from the finished pages: the club
// documentation and module pages, the content pages and the start page with its FAQ, split into sections at
// each <h2>. The Worker lets Clef pick the sections that fit a question and gives only those to the language
// model (site/chat.mjs). Built from the HTML, not the Markdown, so links and anchors are those of the website.
import { Marked } from "marked";
import { GITHUB, ORIGIN } from "./layout.mjs";

/** Longest section text; a longer one is cut (the model gets at most a few sections per question). */
const MAX_SECTION = 6000;
/** Paths left out: legal notice, contact form, release notes and the overview of the docs. The privacy policy stays: it describes the chat. */
const SKIP = /^\/en\/(legal|contact|news|docs)\/$|\/sent\/$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const absolute = (href) => (href.startsWith("/") ? `${ORIGIN}${href}` : href);

/** Our own page HTML as plain text with Markdown-like lists and links written out as "text (url)". */
export function htmlToText(html) {
  const text = html
    .replace(/<(script|style|figure|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (href.startsWith("#") || href.startsWith("mailto:")) return label;
      const url = absolute(decode(href));
      return label && label !== url ? `${label} (${url})` : url;
    })
    .replace(/<h3\b[^>]*>/gi, "\n\n### ")
    .replace(/<h4\b[^>]*>/gi, "\n\n#### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<summary\b[^>]*>/gi, "\n\nQ: ")
    .replace(/<\/summary>/gi, "\nA: ")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<(p|div|tr|br|pre|table|ul|ol|details|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** GitHub's heading anchor: lower case, punctuation removed, spaces as hyphens. */
const githubSlug = (html) =>
  plain(html)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
const plain = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/**
 * Sections of one built page: [{ id, lang, title, url, text }]. The id is the path plus the anchor,
 * the url points to the section on kabine.dev.
 */
export function pageSections(path, html, base = `${ORIGIN}${path}`) {
  const lang = /<html lang="(\w+)"/.exec(html)?.[1] ?? "en";
  let main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
  // Without breadcrumbs, the call to action under every content page and the source links of the docs
  main = main
    .replace(/<nav class="crumbs"[\s\S]*?<\/nav>/g, "")
    .replace(/<section class="demo">[\s\S]*?<\/section>/g, "")
    .replace(/<p class="source">[\s\S]*?<\/p>/g, "");
  const pageTitle = plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(main)?.[1] ?? /<title>([^<]*)/.exec(html)?.[1] ?? path);
  const parts = main.split(/(?=<h2\b)/);
  const sections = [];
  parts.forEach((part, i) => {
    let title = pageTitle;
    let anchor = "";
    let body = part;
    if (i > 0) {
      const h2 = /^<h2\b([^>]*)>([\s\S]*?)<\/h2>/.exec(part);
      if (!h2) return;
      title = `${pageTitle} › ${plain(h2[2])}`;
      // The anchor is on the heading (docs) or on the section around it (content and start pages)
      anchor = /\bid="([^"]+)"/.exec(h2[1])?.[1] ?? [...parts[i - 1].matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].pop()?.[1] ?? "";
      body = part.slice(h2[0].length);
    } else {
      body = part.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, "").replace(/<p class="eyebrow">[\s\S]*?<\/p>/, "");
    }
    let text = htmlToText(body);
    if (text.length < 40) return;
    if (text.length > MAX_SECTION) text = `${text.slice(0, text.lastIndexOf(" ", MAX_SECTION))} …`;
    sections.push({ id: `${path}${anchor ? `#${anchor}` : ""}`, lang, title, url: `${base}${anchor ? `#${anchor}` : ""}`, text });
  });
  return sections;
}

/**
 * The bundle for the Worker from the built pages [{ path, html }]: the English sections (every page exists
 * in English; the model answers in the visitor's language) and, per English page, its German version from
 * the page's hreflang link, so a German answer can link to it.
 */
export function chatDocs(pages, modules = []) {
  const sections = [];
  const german = {};
  // Module READMEs that have no page on the website (yet) link to GitHub; the "Code" part is for contributors
  for (const { id, markdown } of modules) {
    if (pages.some((p) => p.path.startsWith("/en/docs/modules/") && p.path.includes(`/${id}/`))) continue;
    const body = new Marked({ gfm: true }).parse(markdown.replace(/\n## Code\b[\s\S]*$/, "\n"));
    const url = `${GITHUB}/blob/main/modules/${id}/README.md`;
    sections.push(...pageSections(`modules/${id}`, `<html lang="en"><main>${body.replace(/<h2>([^<]*)<\/h2>/g, (_, t) => `<h2 id="${githubSlug(t)}">${t}</h2>`)}</main>`, url));
  }
  for (const { path, html } of pages) {
    if (SKIP.test(path) || !path.startsWith("/en/")) continue;
    sections.push(...pageSections(path, html));
    const de = /<link rel="alternate" hreflang="de" href="([^"]+)"/.exec(html)?.[1];
    if (de) german[`${ORIGIN}${path}`] = de;
  }
  return { sections, german };
}
