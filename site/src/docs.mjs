// The club documentation (docs/*.md), the module READMEs (modules/*/README.md, German in README.de.md) and the
// release notes (CHANGELOG.md) as pages of kabine.dev, so guides live on the project's own domain and GitHub stays
// the source. Links to other documents become links to their pages here (in the page's language where there is
// one) or to the file on GitHub; images from other hosts (the deploy button) become buttons (CSP: own images only).
import { existsSync, readFileSync } from "node:fs";
import { Marked } from "marked";
import { contentPage, GITHUB, ORIGIN } from "./layout.mjs";

const read = (f) => readFileSync(f, "utf8");

/** The module folders in the order of the switches in administration (modules/index.ts, MODULES). */
function moduleOrder() {
  const index = read("modules/index.ts");
  const folderOf = Object.fromEntries([...index.matchAll(/^import (\w+) from "\.\/([\w-]+)\/module";$/gm)].map(([, name, dir]) => [name, dir]));
  const list = index.slice(index.indexOf("export const MODULES = ["));
  return [...list.slice(0, list.indexOf("]")).matchAll(/^\s+(\w+),$/gm)].map(([, name]) => folderOf[name]).filter((dir) => existsSync(`modules/${dir}/README.md`));
}

/** What the manifest (modules/<id>/module.ts) says about switching a module on; German label from locales/de.po. */
function manifest(dir) {
  const src = read(`modules/${dir}/module.ts`);
  const label = /label: \(\) => t`([^`]+)`/.exec(src)?.[1] ?? dir;
  const po = read("locales/de.po");
  const de = new RegExp(`\\nmsgid "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\nmsgstr "([^"]*)"`).exec(po)?.[1] || label;
  return {
    id: /\bid: "([\w-]+)"/.exec(src)?.[1] ?? dir,
    kind: /\bkind: "(\w+)"/.exec(src)?.[1] ?? "feature",
    beta: /\bstatus: "beta"/.test(src),
    defaultOn: /\bdefaultOn: true/.test(src),
    sports: [.../\bsports: \[([^\]]*)\]/.exec(src)?.[1].matchAll(/"([\w-]+)"/g) ?? []].map((m) => m[1]),
    label: { en: label, de },
  };
}

const SPORT = { handball: { en: "handball", de: "Handball" }, football: { en: "football", de: "Fußball" } };

/** Where a module is switched on and its state for a new club, from the manifest, so it cannot drift from the code. */
function switchFacts(m, lang) {
  const de = lang === "de";
  const fixtures = m.kind === "fixtures";
  const where = de
    ? `<em>Verwaltung → Module → ${fixtures ? "Spielplan-Quellen → " : ""}${m.label.de}</em>`
    : `<em>Administration → Modules → ${fixtures ? "Game schedule sources → " : ""}${m.label.en}</em>`;
  const link = !fixtures
    ? ""
    : de
      ? " Danach verknüpft jede Mannschaft ihren Spielplan unter <em>Mannschaft → Einstellungen → Spielplan</em>."
      : " Then each team links its schedule under <em>Team → Settings → Game schedule</em>.";
  const state = m.beta
    ? de
      ? "Beta, für neue Vereine aus"
      : "beta, off for a new club"
    : m.defaultOn
      ? de
        ? "für neue Vereine an"
        : "on for a new club"
      : de
        ? "für neue Vereine aus"
        : "off for a new club";
  const sports = m.sports.map((s) => SPORT[s]?.[lang] ?? s).join(", ");
  const only = sports ? (de ? ` Nur für Vereine mit ${sports}.` : ` Only offered to ${sports} clubs.`) : "";
  return `<p class="switch-on"><b>${de ? "Einschalten" : "Switch on"}:</b> ${where} (${state}).${link}${only}</p>`;
}

/** Sections of a module README for contributors only (the file map); the page links the README on GitHub instead. */
const CONTRIBUTOR_SECTIONS = new Set(["Code"]);

/** Documents published as pages: source file -> path. Language versions share an id. */
export const DOCS = [
  { id: "install", file: "docs/install.md", lang: "en", path: "/en/docs/install/" },
  { id: "install", file: "docs/install.de.md", lang: "de", path: "/docs/installation/" },
  { id: "operation", file: "docs/operation.md", lang: "en", path: "/en/docs/operation/" },
  { id: "operation", file: "docs/operation.de.md", lang: "de", path: "/docs/betrieb/" },
  { id: "privacy", file: "docs/privacy.md", lang: "en", path: "/en/docs/privacy/" },
  { id: "privacy", file: "docs/privacy.de.md", lang: "de", path: "/docs/datenschutz/" },
  ...moduleOrder().flatMap((dir) => {
    // The path is the module id in kebab case, which the app links to (shared/site-docs.ts, moduleDocsSlug)
    const page = manifest(dir).id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return [
      { id: `module:${dir}`, module: dir, file: `modules/${dir}/README.md`, lang: "en", path: `/en/docs/modules/${page}/` },
      { id: `module:${dir}`, module: dir, file: `modules/${dir}/README.de.md`, lang: "de", path: `/docs/module/${page}/` },
    ];
  }),
].filter((d) => existsSync(d.file));

/** A link in a document, resolved against its folder: a page here (the language's version if any), the file on GitHub, or as it is. */
function resolveLink(href, from, lang) {
  // Links to kabine.dev itself (so they also work on GitHub) become paths, checked like every internal link
  if (href.startsWith(`${ORIGIN}/`)) return href.slice(ORIGIN.length);
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [file, anchor] = href.split("#");
  const parts = from.split("/").slice(0, -1);
  for (const seg of file.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const target = parts.join("/");
  const doc = DOCS.find((d) => d.file === target);
  // A link to the other language's version itself stays there; any other link prefers the page's language
  const own = doc && DOCS.find((d) => d.id === doc.id && d.lang === lang);
  const sameDoc = doc && DOCS.find((d) => d.file === from)?.id === doc.id;
  const page = doc && (sameDoc ? doc : (own ?? doc));
  if (page) return anchor ? `${page.path}#${anchor}` : page.path;
  return `${GITHUB}/blob/main/${target}${anchor ? `#${anchor}` : ""}`;
}

/** Anchor of a heading: lower case, letters and digits joined by "-" (the app links to some, shared/site-docs.ts). */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function render(markdown, from, lang) {
  const marked = new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        // The deploy button: an image link to Cloudflare becomes a button
        if (tokens.length === 1 && tokens[0].type === "image") return `<a class="btn primary on-light" href="${href}">${tokens[0].text}</a>`;
        return `<a href="${resolveLink(href, from, lang)}"${title ? ` title="${title}"` : ""}>${text}</a>`;
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

/** The markdown without the h2 sections meant for contributors only. */
function withoutContributorSections(body) {
  const out = [];
  let skip = false;
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) skip = CONTRIBUTOR_SECTIONS.has(line.slice(3).trim());
    if (!skip) out.push(line);
  }
  return out.join("\n");
}

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const short = (text, n = 155) => (text.length <= n ? text : `${text.slice(0, text.lastIndexOf(" ", n - 1))} …`);

/** Source and edit links under every page generated from the repository. */
const sourceLine = (file, de) =>
  `<p class="source">${de ? "Quelle" : "Source"}: <a href="${GITHUB}/blob/main/${file}">${file}</a> · <a href="${GITHUB}/edit/main/${file}">${
    de ? "Auf GitHub bearbeiten" : "Edit on GitHub"
  }</a></p>`;

/** Title and lead of a document, for the cards of the overview. */
function summary(d) {
  const { title, lead } = split(read(d.file));
  // A lead that introduces a list ("Three kinds:") ends before that sentence
  return { title, text: short(plain(render(lead, d.file, d.lang)).replace(/\s*[^.!?]*:$/, ""), 170) };
}

export function docPages() {
  return DOCS.map((d) => {
    const { title, lead, body } = split(read(d.file));
    const sibling = DOCS.find((o) => o.id === d.id && o.lang !== d.lang);
    const alternates = { [d.lang]: d.path, ...(sibling ? { [sibling.lang]: sibling.path } : {}) };
    const de = d.lang === "de";
    const leadHtml = render(lead, d.file, d.lang).replace(/^<p>|<\/p>\s*$/g, "");
    const facts = d.module ? switchFacts(manifest(d.module), d.lang) : "";
    const content = render(d.module ? withoutContributorSections(body) : body, d.file, d.lang);
    const docs = [de ? "Dokumentation" : "Documentation", de ? "/docs/" : "/en/docs/"];
    return {
      path: d.path,
      html: contentPage({
        lang: d.lang,
        path: d.path,
        title: `${title} – ${d.module ? (de ? "Modul von Kabine" : "Kabine module") : "Kabine"}`,
        description: short(plain(leadHtml)),
        alternates,
        kicker: d.module ? (de ? "Modul" : "Module") : docs[0],
        h1: title,
        lead: leadHtml,
        crumbs: d.module ? [docs, [de ? "Module" : "Modules", `${docs[1]}#${de ? "module" : "modules"}`]] : [docs],
        body: `<section><div class="wrap prose">${facts}${content}${sourceLine(d.file, de)}</div></section>`,
      }),
      alternates,
    };
  });
}

/** Overview of the documentation, per language: the guides, then one card per module. */
export function docsHub(lang) {
  const de = lang === "de";
  const page = (id) => DOCS.find((d) => d.id === id && d.lang === lang) ?? DOCS.find((d) => d.id === id);
  const english = (id) => (de && page(id)?.lang === "en" ? " (Englisch)" : "");
  const item = (href, title, text) => `<a class="card link-card" href="${href}"><h3>${title}</h3><p>${text}</p></a>`;
  const guides = de
    ? [
        item(page("install").path, `Installation${english("install")}`, "Kabine im eigenen Cloudflare-Konto einrichten: Knopf, Domain, erster Admin, E-Mail, Einladungen, Updates."),
        item(page("operation").path, `Betrieb${english("operation")}`, "Saisonwechsel, Sicherung, Wartungsmodus, Updates mit Wiederherstellungspunkt, Logs, Geheimnisse."),
        item(page("privacy").path, "Datenschutz und Datenverzeichnis", "Welche Daten Kabine speichert, wer sie sieht, wann sie gelöscht werden, und eine Vorlage für die Datenschutzerklärung."),
        item("/en/news/", "Versionshinweise (Englisch)", "Was sich mit jeder Version ändert."),
        item(`${GITHUB}/blob/main/AGENTS.md`, "Mitentwickeln", "Einstieg für Beiträge mit oder ohne Coding-Agent: Module, Spielplan-Anbindungen, Sportarten, Übersetzungen."),
      ]
    : [
        item("/en/docs/install/", "Installation", "Set up Kabine in your own Cloudflare account: button, domain, first admin, e-mail, invitations, updates."),
        item("/en/docs/operation/", "Running Kabine", "Season change, backup, maintenance mode, updates with a restore point, logs, secrets."),
        item("/en/docs/privacy/", "Privacy and data inventory", "Which data Kabine stores, who sees it, when it is deleted, and a template for the club's privacy policy."),
        item("/en/news/", "Release notes", "What changes with each version."),
        item(`${GITHUB}/blob/main/AGENTS.md`, "Contributing", "Where to start with or without a coding agent: modules, game schedule connectors, sports, translations."),
      ];
  const modules = moduleOrder().map((dir) => {
    const d = page(`module:${dir}`);
    const { title, text } = summary(d);
    return item(d.path, `${title}${d.lang !== lang && de ? " (Englisch)" : ""}`, text);
  });
  const body = `<section><div class="wrap"><div class="grid g3">${guides.join("")}</div></div></section>
<section class="alt" id="${de ? "module" : "modules"}"><div class="wrap">
  <p class="kicker">${de ? "Module" : "Modules"}</p>
  <h2>${de ? "Was ein Verein dazuschalten kann." : "What a club can switch on."}</h2>
  <p class="sub">${
    de
      ? "Jedes Modul schaltet ein Admin unter <em>Verwaltung → Module</em> ein oder aus. Hier steht, was es tut, was es speichert und wer es sieht."
      : "An admin switches each module on or off under <em>Administration → Modules</em>. Here is what it does, what it stores and who sees it."
  }</p>
  <div class="grid g3">${modules.join("")}</div>
</div></section>`;
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
        ? "Anleitungen für Vereine: Kabine installieren und betreiben, Datenschutz mit Datenverzeichnis, und jedes Modul mit dem, was es speichert."
        : "Guides for clubs: install and run Kabine, privacy with a data inventory, and every module with what it stores.",
      alternates,
      kicker: de ? "Dokumentation" : "Documentation",
      h1: de ? "Anleitungen für Vereine." : "Guides for clubs.",
      lead: de
        ? "Alles, was ein Verein für die eigene Installation braucht. Die Texte stehen im Repository auf GitHub; jede Seite verlinkt ihre Quelle."
        : "Everything a club needs to set up and run its own installation. The texts live in the repository on GitHub; every page links its source.",
      body,
    }),
  };
}

/** Release notes from CHANGELOG.md (English). */
export function newsPage() {
  const md = read("CHANGELOG.md");
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
      body: `<section><div class="wrap prose">${render(body, "CHANGELOG.md", "en")}${sourceLine("CHANGELOG.md", false)}</div></section>`,
    }),
  };
}
