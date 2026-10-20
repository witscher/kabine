// Shared parts of the kabine.dev pages: head (title, description, canonical, language versions, share
// preview, structured data), header and footer. Used by scripts/site-build.mjs for the start pages and
// every content page, so all pages link to each other the same way.
export const ORIGIN = "https://kabine.dev";
export const GITHUB = "https://github.com/witscher/kabine";

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Pages linked in every footer, per language: [path, label]. */
const FOOTER_LINKS = {
  de: [
    ["/warum-kabine/", "Warum Kabine"],
    ["/handball/", "Handball"],
    ["/fussball/", "Fußball"],
    ["/jugendtrainer/", "Für Jugendtrainer"],
    ["/vorstand-datenschutz/", "Für Vorstand und Datenschutz"],
    ["/funktionen/helferdienste/", "Helferdienste"],
    ["/funktionen/fahrgemeinschaften/", "Fahrgemeinschaften"],
    ["/funktionen/anwesenheit/", "Anwesenheit"],
    ["/docs/", "Dokumentation"],
  ],
  en: [
    ["/en/why-kabine/", "Why Kabine"],
    ["/en/handball/", "Handball"],
    ["/en/football/", "Football"],
    ["/en/youth-coaches/", "For youth coaches"],
    ["/en/club-board-privacy/", "For the board and privacy"],
    ["/en/features/helper-duties/", "Helper duties"],
    ["/en/features/carpools/", "Carpools"],
    ["/en/features/attendance/", "Attendance"],
    ["/en/docs/", "Documentation"],
    ["/en/news/", "Release notes"],
  ],
};

/**
 * Head tags for one page. alternates: { de?: path, en?: path } of the same page in both languages
 * (only the existing ones). jsonLd: objects for <script type="application/ld+json">.
 */
export function head({ lang, path, title, description, alternates = {}, jsonLd = [], preload = null }) {
  const url = `${ORIGIN}${path}`;
  const ogLocale = lang === "de" ? "de_DE" : "en_GB";
  const image = `${ORIGIN}/og-${lang}.png`;
  const alt = [];
  for (const [l, p] of Object.entries(alternates)) alt.push(`<link rel="alternate" hreflang="${l}" href="${ORIGIN}${p}">`);
  // x-default: the German page where there is one (the project's home), otherwise the only version
  const xDefault = alternates.de ?? alternates.en;
  if (xDefault) alt.push(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}${xDefault}">`);
  const otherLocale = Object.keys(alternates).filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${l === "de" ? "de_DE" : "en_GB"}">`);
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    `<link rel="canonical" href="${url}">`,
    ...alt,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">`,
    `<meta name="theme-color" content="#121212">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Kabine">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${lang === "de" ? "Kabine, die freie Mannschafts-App, auf zwei Handys" : "Kabine, the free team app, on two phones"}">`,
    `<meta property="og:locale" content="${ogLocale}">`,
    ...otherLocale,
    `<meta name="twitter:card" content="summary_large_image">`,
    ...(preload ? [`<link rel="preload" as="image" href="${preload}" type="image/webp" fetchpriority="high">`] : []),
    `<link rel="preload" as="font" href="/fonts/barlow-condensed-latin-800-normal.woff2" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="/style.css">`,
    `<script src="/lang.js" defer></script>`,
    ...jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`),
  ].join("\n");
}

/** Header of the content pages; the start pages keep their own with the section anchors. */
export function header(lang, alternates) {
  const de = lang === "de";
  const other = de ? alternates.en : alternates.de;
  const home = de ? "/" : "/en/";
  return `<header class="top">
  <div class="wrap">
    <a class="brand" href="${home}"><img src="/icon.svg" alt="" width="30" height="30">Kabine</a>
    <nav aria-label="${de ? "Hauptmenü" : "Main menu"}">
      <a href="${home}#${de ? "funktionen" : "features"}">${de ? "Funktionen" : "Features"}</a>
      <a class="keep" href="${home}#demo">Demo</a>
      <a href="${de ? "/warum-kabine/" : "/en/why-kabine/"}">${de ? "Warum Kabine" : "Why Kabine"}</a>
      <a href="${de ? "/docs/" : "/en/docs/"}">${de ? "Doku" : "Docs"}</a>
      ${other ? `<a class="lang" href="${other}" hreflang="${de ? "en" : "de"}" data-lang="${de ? "en" : "de"}">${de ? "EN" : "DE"}</a>` : ""}
    </nav>
  </div>
</header>`;
}

export function footer(lang, alternates = {}) {
  const de = lang === "de";
  const other = de ? alternates.en : alternates.de;
  const links = FOOTER_LINKS[lang].map(([href, label]) => `<a href="${href}">${label}</a>`).join("\n      ");
  return `<footer>
  <div class="wrap">
    <nav class="footer-links" aria-label="${de ? "Seiten" : "Pages"}">
      ${links}
    </nav>
    <div class="footer-meta">
      <span>Kabine · ${de ? "freie Software unter AGPL-3.0" : "free software under AGPL-3.0"}</span>
      <a href="${de ? "/impressum/" : "/en/legal/"}">${de ? "Impressum und Datenschutz" : "Legal notice and privacy"}</a>
      <a href="${GITHUB}">GitHub</a>
      ${other ? `<a class="push" href="${other}" hreflang="${de ? "en" : "de"}" data-lang="${de ? "en" : "de"}">${de ? "English" : "Deutsch"}</a>` : ""}
    </div>
  </div>
</footer>`;
}

/** Breadcrumb trail for structured data: [[name, path], …] from the start page. */
export function breadcrumbs(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${ORIGIN}${path}` })),
  };
}

/** A content page: header, hero with kicker, h1 and lead, the body, the closing call to action, footer. */
export function contentPage({ lang, path, title, description, alternates, kicker, h1, lead, body, crumbs = [], jsonLd = [] }) {
  const de = lang === "de";
  const home = de ? "/" : "/en/";
  const trail = [[de ? "Start" : "Home", home], ...crumbs, [h1.replace(/<[^>]+>/g, ""), path]];
  return `<!doctype html>
<html lang="${lang}">
<head>
${head({ lang, path, title, description, alternates, jsonLd: [breadcrumbs(trail), ...jsonLd] })}
</head>
<body>
${header(lang, alternates)}
<main>
<div class="hero page-hero">
  <div class="wrap">
    <nav class="crumbs" aria-label="${de ? "Pfad" : "Breadcrumb"}">${trail
      .slice(0, -1)
      .map(([name, p]) => `<a href="${p}">${name}</a>`)
      .join(" / ")}</nav>
    <p class="eyebrow">${kicker}</p>
    <h1>${h1}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ""}
  </div>
</div>
${body}
${callToAction(lang)}
</main>
${footer(lang, alternates)}
</body>
</html>
`;
}

function callToAction(lang) {
  const de = lang === "de";
  return `<section class="demo">
  <div class="wrap">
    <p class="kicker">${de ? "Ausprobieren" : "Try it"}</p>
    <h2>${de ? "In der Demo, in jeder Rolle." : "In the demo, in every role."}</h2>
    <p class="sub">${
      de
        ? "Spielerin, Elternteil, Trainerin oder Admin: ein Tipp, und du bist im erfundenen Verein „SV Musterstadt“. Ohne Registrierung, jede Nacht zurückgesetzt."
        : "Player, parent, coach or admin: one tap and you are in the invented club “SV Musterstadt”. No sign-up, reset every night."
    }</p>
    <div class="cta">
      <a class="btn primary" href="${de ? "/#demo" : "/en/#demo"}">${de ? "Zur Demo" : "Open the demo"}</a>
      <a class="btn ghost" href="${de ? "/en/docs/install/" : "/en/docs/install/"}">${de ? "Installation (Englisch)" : "Installation guide"}</a>
    </div>
  </div>
</section>`;
}
