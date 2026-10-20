// The club documentation (docs/*.md) and the release notes (CHANGELOG.md) as pages of kabine.dev, so
// guides live on the project's own domain. Links to other documents become links to their pages here
// or to the file on GitHub; images from other hosts (the deploy button) become buttons (CSP: own images only).
import { readFileSync } from "node:fs";
import { Marked } from "marked";
import { contentPage, GITHUB } from "./layout.mjs";

/** Documents published as pages: source file -> path. Language versions share an id. */
export const DOCS = [
  { id: "install", file: "docs/install.md", lang: "en", path: "/en/docs/install/" },
  { id: "operation", file: "docs/operation.md", lang: "en", path: "/en/docs/operation/" },
  { id: "privacy", file: "docs/privacy.md", lang: "en", path: "/en/docs/privacy/" },
  { id: "privacy", file: "docs/privacy.de.md", lang: "de", path: "/docs/datenschutz/" },
];

const byFile = new Map(DOCS.map((d) => [d.file, d.path]));

/** A link in a document, resolved against its folder: a page here, the file on GitHub, or as it is. */
function resolveLink(href, from) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [file, anchor] = href.split("#");
  const parts = from.split("/").slice(0, -1);
  for (const seg of file.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const target = parts.join("/");
  const page = byFile.get(target);
  if (page) return anchor ? `${page}#${anchor}` : page;
  return `${GITHUB}/blob/main/${target}${anchor ? `#${anchor}` : ""}`;
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function render(markdown, from) {
  const marked = new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        // The deploy button: an image link to Cloudflare becomes a button
        if (tokens.length === 1 && tokens[0].type === "image") return `<a class="btn primary on-light" href="${href}">${tokens[0].text}</a>`;
        return `<a href="${resolveLink(href, from)}"${title ? ` title="${title}"` : ""}>${text}</a>`;
      },
      image({ text }) {
        return text;
      },
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        // The document's own title is the page's h1
        if (depth === 1) return "";
        return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
      },
      table(token) {
        // Wide tables scroll on phones instead of widening the page
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  return marked.parse(markdown);
}

/** Title (the first heading) and the paragraph after it, for the hero. */
function split(markdown) {
  const lines = markdown.split("\n");
  const titleLine = lines.findIndex((l) => l.startsWith("# "));
  const title = lines[titleLine].slice(2).trim();
  const rest = lines.slice(titleLine + 1);
  const firstPara = rest.findIndex((l) => l.trim());
  let end = firstPara;
  while (end < rest.length && rest[end].trim() && !rest[end].startsWith("#")) end++;
  const lead = rest.slice(firstPara, end).join(" ");
  return { title, lead, body: rest.slice(end).join("\n") };
}

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const short = (text, n = 155) => (text.length <= n ? text : `${text.slice(0, text.lastIndexOf(" ", n - 1))} …`);

export function docPages() {
  return DOCS.map((d) => {
    const md = readFileSync(d.file, "utf8");
    const { title, lead, body } = split(md);
    const sibling = DOCS.find((o) => o.id === d.id && o.lang !== d.lang);
    const alternates = { [d.lang]: d.path, ...(sibling ? { [sibling.lang]: sibling.path } : {}) };
    const de = d.lang === "de";
    const leadHtml = render(lead, d.file).replace(/^<p>|<\/p>\s*$/g, "");
    return {
      path: d.path,
      html: contentPage({
        lang: d.lang,
        path: d.path,
        title: `${title} – Kabine`,
        description: short(plain(leadHtml)),
        alternates,
        kicker: de ? "Dokumentation" : "Documentation",
        h1: title,
        lead: leadHtml,
        crumbs: [[de ? "Dokumentation" : "Documentation", de ? "/docs/" : "/en/docs/"]],
        body: `<section><div class="wrap prose">${render(body, d.file)}<p class="source">${
          de ? "Quelle" : "Source"
        }: <a href="${GITHUB}/blob/main/${d.file}">${d.file}</a></p></div></section>`,
      }),
      alternates,
    };
  });
}

/** Overview of the documentation, per language. */
export function docsHub(lang) {
  const de = lang === "de";
  const item = (href, title, text) => `<a class="card link-card" href="${href}"><h3>${title}</h3><p>${text}</p></a>`;
  const body = `<section><div class="wrap"><div class="grid g3">${
    de
      ? [
          item("/en/docs/install/", "Installation (Englisch)", "Kabine im eigenen Cloudflare-Konto einrichten: Knopf, Domain, erster Admin, E-Mail, Einladungen, Updates."),
          item("/en/docs/operation/", "Betrieb (Englisch)", "Saisonwechsel, Sicherung, Wartungsmodus, Updates mit Wiederherstellungspunkt, Logs, Geheimnisse."),
          item("/docs/datenschutz/", "Datenschutz und Datenverzeichnis", "Welche Daten Kabine speichert, wer sie sieht, wann sie gelöscht werden, und eine Vorlage für die Datenschutzerklärung."),
          item("/en/news/", "Versionshinweise (Englisch)", "Was sich mit jeder Version ändert."),
          item(`${GITHUB}/blob/main/AGENTS.md`, "Mitentwickeln", "Einstieg für Beiträge mit oder ohne Coding-Agent: Module, Spielplan-Anbindungen, Sportarten, Übersetzungen."),
        ]
      : [
          item("/en/docs/install/", "Installation", "Set up Kabine in your own Cloudflare account: button, domain, first admin, e-mail, invitations, updates."),
          item("/en/docs/operation/", "Running Kabine", "Season change, backup, maintenance mode, updates with a restore point, logs, secrets."),
          item("/en/docs/privacy/", "Privacy and data inventory", "Which data Kabine stores, who sees it, when it is deleted, and a template for the club's privacy policy."),
          item("/en/news/", "Release notes", "What changes with each version."),
          item(`${GITHUB}/blob/main/AGENTS.md`, "Contributing", "Where to start with or without a coding agent: modules, game schedule connectors, sports, translations."),
        ]
  }.join("")}</div></div></section>`;
  const path = de ? "/docs/" : "/en/docs/";
  const alternates = { de: "/docs/", en: "/en/docs/" };
  return {
    path,
    alternates,
    html: contentPage({
      lang,
      path,
      title: de ? "Dokumentation – Kabine, die freie Mannschafts-App" : "Documentation – Kabine, the free team app",
      description: de
        ? "Anleitungen für Vereine: Kabine installieren und betreiben, Datenschutz mit Datenverzeichnis und Vorlage für die Datenschutzerklärung."
        : "Guides for clubs: install and run Kabine, privacy with a data inventory and a template for the club's privacy policy.",
      alternates,
      kicker: de ? "Dokumentation" : "Documentation",
      h1: de ? "Anleitungen für Vereine." : "Guides for clubs.",
      lead: de
        ? "Installation und Betrieb gibt es bisher auf Englisch, Datenschutz auch auf Deutsch."
        : "Everything a club needs to set up and run its own installation.",
      body,
    }),
  };
}

/** Release notes from CHANGELOG.md (English). */
export function newsPage() {
  const md = readFileSync("CHANGELOG.md", "utf8");
  // From the first version on; the introduction above it is for maintainers
  const body = md.slice(md.indexOf("\n## ") + 1);
  const path = "/en/news/";
  const alternates = { en: path };
  return {
    path,
    alternates,
    html: contentPage({
      lang: "en",
      path,
      title: "Release notes – Kabine, the free team app",
      description: "What changes with each version of Kabine: new features, fixes and database changes, for the people who run a club's installation.",
      alternates,
      kicker: "Release notes",
      h1: "What's new in Kabine.",
      lead: "Changes per version, written for the people who run a club's installation. Updates arrive as a pull request in the club's copy.",
      crumbs: [["Documentation", "/en/docs/"]],
      body: `<section><div class="wrap prose">${render(body, "CHANGELOG.md")}</div></section>`,
    }),
  };
}
