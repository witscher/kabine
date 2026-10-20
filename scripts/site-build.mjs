// Builds the project website (kabine.dev) into site/dist: start pages, content pages (site/src/pages.mjs),
// the club documentation and release notes as pages (site/src/docs.mjs), sitemap, robots.txt, 404, the demo
// screenshots as WebP and the self-hosted fonts. The legal notice needs the publisher's details from
// site/legal.json (not in the repository, see site/legal.example.json); `--preview` builds with placeholders.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { docPages, docsHub, newsPage } from "../site/src/docs.mjs";
import { contentPage, footer, GITHUB, head, ORIGIN } from "../site/src/layout.mjs";
import { PAGES, softwareApplication } from "../site/src/pages.mjs";

const preview = process.argv.includes("--preview");
const out = "site/dist";
const read = (f) => readFileSync(f, "utf8");
const write = (path, html) => {
  const file = path.endsWith("/") ? `${out}${path}index.html` : `${out}${path}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
};

let legal;
if (existsSync("site/legal.json")) {
  legal = JSON.parse(read("site/legal.json"));
} else if (preview) {
  legal = { name: "[name]", street: "[street]", city: "[postcode city]", email: "[e-mail]" };
} else {
  console.error("site/legal.json is missing (name, street, city, email of the publisher). Copy site/legal.example.json, or use --preview.");
  process.exit(1);
}
for (const key of ["name", "street", "city", "email"]) {
  if (!legal[key]) throw new Error(`site/legal.json: "${key}" is empty`);
}
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (html) =>
  html
    .replace("{{LEGAL_NAME}}", escape(legal.name))
    .replace("{{LEGAL_STREET}}", escape(legal.street))
    .replace("{{LEGAL_CITY}}", escape(legal.city))
    .replace("{{LEGAL_EMAIL}}", escape(legal.email));

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/fonts`, { recursive: true });

/** Every indexable page with its language versions, for the sitemap. */
const sitemap = [];

// Start pages ---------------------------------------------------------------------------------------------
const START = {
  de: {
    title: "Kabine – kostenlose Mannschafts-App für Vereine, Open Source",
    description:
      "Kostenlose Mannschafts-App für Vereine: Zu- und Absagen, Kader, Chat, Helferdienste, Fahrgemeinschaften. Open Source, eigene Installation, ohne Passwörter.",
  },
  en: {
    title: "Kabine – free team app for sports clubs, open source",
    description: "Free team app for sports clubs: yes/no responses, squads, chat, helper duties, carpools. Open source, your own installation, no passwords.",
  },
};
const startAlternates = { de: "/", en: "/en/" };
/** The questions of the start page as FAQPage data (from the <details class="faq"> elements). */
const faqData = (html) => {
  const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const items = [...html.matchAll(/<details class="faq"><summary>(.*?)<\/summary>(.*?)<\/details>/gs)];
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(([, q, a]) => ({ "@type": "Question", name: plain(q), acceptedAnswer: { "@type": "Answer", text: plain(a) } })),
  };
};
for (const lang of ["de", "en"]) {
  const path = startAlternates[lang];
  const source = read(`site/src/index.${lang}.html`);
  const website = { "@context": "https://schema.org", "@type": "WebSite", name: "Kabine", url: `${ORIGIN}${path}`, inLanguage: lang };
  const html = source
    .replace(
      "{{HEAD}}",
      head({
        lang,
        path,
        ...START[lang],
        alternates: startAlternates,
        jsonLd: [website, softwareApplication(lang), faqData(source)],
        preload: `/shots/${lang}/01-events.webp`,
      }),
    )
    .replace("{{FOOTER}}", footer(lang, startAlternates));
  write(path, html);
  sitemap.push({ path, alternates: startAlternates });
}

// Content pages, documentation, release notes -------------------------------------------------------------
for (const page of PAGES) {
  const alternates = Object.fromEntries(["de", "en"].filter((l) => page[l]).map((l) => [l, page[l].path]));
  for (const lang of ["de", "en"]) {
    const p = page[lang];
    if (!p) continue;
    write(p.path, contentPage({ lang, ...p, alternates, jsonLd: p.jsonLd?.(lang) ?? [] }));
    sitemap.push({ path: p.path, alternates });
  }
}
for (const page of [...docPages(), docsHub("de"), docsHub("en"), newsPage()]) {
  write(page.path, page.html);
  sitemap.push({ path: page.path, alternates: page.alternates });
}

// Legal notice (not in the sitemap) and 404 ---------------------------------------------------------------
write("/impressum/", fill(read("site/src/legal.de.html")));
write("/en/legal/", fill(read("site/src/legal.en.html")));
write(
  "/404.html",
  `<!doctype html>
<html lang="de">
<head>
${head({ lang: "de", path: "/404.html", title: "Seite nicht gefunden – Kabine", description: "Diese Seite gibt es nicht." }).replace(/<link rel="canonical"[^>]*>\n/, "")}
<meta name="robots" content="noindex">
</head>
<body>
<main>
<div class="hero page-hero">
  <div class="wrap">
    <p class="eyebrow">404</p>
    <h1>Diese Seite gibt es nicht.</h1>
    <p class="lead">This page does not exist.</p>
    <div class="cta">
      <a class="btn primary" href="/">Zur Startseite</a>
      <a class="btn ghost" href="/en/" hreflang="en">English home page</a>
      <a class="btn ghost" href="/docs/">Dokumentation</a>
    </div>
  </div>
</div>
</main>
${footer("de")}
</body>
</html>
`,
);

// Sitemap and robots.txt ----------------------------------------------------------------------------------
writeFileSync(
  `${out}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemap
  .map(
    ({ path, alternates }) => `  <url>
    <loc>${ORIGIN}${path}</loc>
${Object.entries(alternates)
  .map(([l, p]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${p}"/>`)
  .join("\n")}
  </url>`,
  )
  .join("\n")}
</urlset>
`,
);
// Search engines and AI assistants may read the site, so that people asking for a club app can find Kabine.
// Training AI models on it is neither granted nor refused here (see the content signals on contentsignals.org).
writeFileSync(
  `${out}/robots.txt`,
  `User-agent: *
Content-Signal: search=yes, ai-input=yes
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`,
);

// Static files, screenshots as WebP, fonts ----------------------------------------------------------------
for (const f of ["style.css", "lang.js", "icon.svg", "_headers", "og-de.png", "og-en.png"]) cpSync(`site/src/${f}`, `${out}/${f}`);
// Screenshots of the demo club (npm run screenshots writes them to docs/screenshots), a third of the PNG size
for (const locale of ["de", "en"]) {
  mkdirSync(`${out}/shots/${locale}`, { recursive: true });
  for (const file of readdirSync(`docs/screenshots/${locale}`).filter((f) => f.endsWith(".png"))) {
    await sharp(`docs/screenshots/${locale}/${file}`).webp({ quality: 82 }).toFile(`${out}/shots/${locale}/${file.replace(/\.png$/, ".webp")}`);
  }
}
for (const [pkg, file] of [
  ["barlow", "barlow-latin-400-normal.woff2"],
  ["barlow", "barlow-latin-600-normal.woff2"],
  ["barlow", "barlow-latin-700-normal.woff2"],
  ["barlow-condensed", "barlow-condensed-latin-700-normal.woff2"],
  ["barlow-condensed", "barlow-condensed-latin-800-normal.woff2"],
]) {
  cpSync(`node_modules/@fontsource/${pkg}/files/${file}`, `${out}/fonts/${file}`);
}

// Every internal link points to a built page (a typo would be a dead link for visitors and search engines)
const pages = new Set(sitemap.map((s) => s.path).concat(["/impressum/", "/en/legal/"]));
const broken = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p);
    else if (p.endsWith(".html")) {
      for (const [, href] of read(p).matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/g)) {
        const isFile = /\.[a-z0-9]+$/.test(href);
        if (isFile ? !existsSync(`${out}${href}`) : !pages.has(href)) broken.push(`${p.slice(out.length)} -> ${href}`);
      }
    }
  }
};
walk(out);
if (broken.length) {
  console.error(`Broken internal links:\n${broken.join("\n")}`);
  process.exit(1);
}
console.log(`Website built in ${out}: ${sitemap.length} pages${preview ? " (preview, legal notice has placeholders)" : ""}. Source: ${GITHUB}`);
