// Banners for club websites: the formats and texts (used by scripts/site-banners.mjs to render the PNGs
// into site/src/banner/) and the page that offers them on kabine.dev (/banner/, /en/banner/).
import { statSync } from "node:fs";
import { ORIGIN } from "./layout.mjs";

/** Texts on the banners, per language. */
export const BANNER_TEXT = {
  de: {
    headline: "Wir nutzen Kabine",
    sub: "die freie Mannschafts-App für Vereinssport",
    feats: ["Kostenlos", "Ohne Werbung", "Nur mit Einladung"],
    alt: "Wir nutzen Kabine, die freie Mannschafts-App für Vereinssport",
  },
  en: {
    headline: "We use Kabine",
    sub: "the free team app for sports clubs",
    feats: ["Free", "No ads", "Invitation only"],
    alt: "We use Kabine, the free team app for sports clubs",
  },
};

/** The four formats. scales: the pixel densities exported as PNG (2 for the formats embedded in a page). */
export const BANNER_FORMATS = [
  {
    id: "rectangle",
    w: 300,
    h: 250,
    scales: [1, 2],
    de: { name: "Rechteck", use: "Fügt sich in Seitenleisten, Widget-Bereiche und zwischen Absätze ein. Passt auf jede Website und jedes Handy." },
    en: { name: "Rectangle", use: "Fits sidebars, widget areas and the space between paragraphs. Works on every website and every phone." },
  },
  {
    id: "wide",
    w: 970,
    h: 250,
    scales: [1, 2],
    de: { name: "Breitbanner", use: "Über oder unter dem Inhalt, etwa auf der Startseite oder der Seite einer Mannschaft. Wird auf kleinen Bildschirmen mit verkleinert." },
    en: { name: "Wide banner", use: "Above or below the content, for example on the home page or a team page. Scales down on small screens." },
  },
  {
    id: "square",
    w: 1080,
    h: 1080,
    scales: [1],
    de: { name: "Social-Media-Post", use: "Für Instagram, Facebook, WhatsApp-Status oder den Elternbrief." },
    en: { name: "Social media post", use: "For Instagram, Facebook, WhatsApp status or the letter to parents." },
  },
  {
    id: "article",
    w: 1200,
    h: 630,
    scales: [1],
    de: { name: "Beitragsbild", use: "Bild für eine Neuigkeit wie „Ab sofort nutzen wir Kabine“ und Vorschaubild, wenn der Beitrag geteilt wird." },
    en: { name: "Article image", use: "Image for a news post like “From now on we use Kabine”, and the preview when the post is shared." },
  },
];

/** File name of one banner with its size in pixels: kabine-banner-de-300x250.png, at double resolution kabine-banner-de-600x500.png */
export const bannerFile = (lang, f, scale = 1) => `kabine-banner-${lang}-${f.w * scale}x${f.h * scale}.png`;

const kb = (file) => `${Math.max(1, Math.round(statSync(`site/src/banner/${file}`).size / 1024))} KB`;
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The HTML a club pastes into its website, with the image on its own server. */
function snippet(lang, f, dir) {
  const t = BANNER_TEXT[lang];
  const file = bannerFile(lang, f);
  const srcset = f.scales.includes(2) ? ` srcset="${dir}${bannerFile(lang, f, 2)} 2x"` : "";
  return `<a href="${ORIGIN}${lang === "de" ? "/" : "/en/"}">
  <img src="${dir}${file}"${srcset}
    width="${f.w}" height="${f.h}" style="max-width:100%;height:auto"
    alt="${t.alt}">
</a>`;
}

function page(lang) {
  const de = lang === "de";
  const dir = de ? "/bilder/" : "/images/";
  const cards = BANNER_FORMATS.map((f) => {
    const t = f[lang];
    const files = f.scales.map((s) => bannerFile(lang, f, s));
    const downloads = files
      .map((file, i) => `<a class="btn ghost on-light" href="/banner/${file}" download>PNG ${f.w * f.scales[i]} × ${f.h * f.scales[i]}<small>${kb(file)}</small></a>`)
      .join("");
    return `<article class="banner-card" id="${f.id}">
      <div class="banner-head"><h3>${t.name}</h3><p>${f.w} × ${f.h} px</p></div>
      <div class="banner-stage"><img loading="lazy" src="/banner/${files[0]}"${files[1] ? ` srcset="/banner/${files[1]} 2x"` : ""} width="${f.w}" height="${f.h}" alt="${BANNER_TEXT[lang].alt} (${f.w} × ${f.h})"></div>
      <p class="banner-use">${t.use}</p>
      <div class="banner-dls">${downloads}</div>
    </article>`;
  }).join("\n");
  const rect = BANNER_FORMATS[0];
  const code = escape(snippet(lang, rect, dir));
  const body = de
    ? `<section>
  <div class="wrap">
    <p class="kicker">Vier Formate</p>
    <h2>Zum Herunterladen.</h2>
    <p class="sub">Alle Banner zeigen den erfundenen Demo-Verein „SV Musterstadt“, keine echten Daten. Die kleinen Formate gibt es auch in doppelter Auflösung für scharfe Bildschirme. Ihr dürft sie frei auf eurer Website und in euren Kanälen verwenden.</p>
    <div class="banner-grid">
${cards}
    </div>
    <p class="more"><a href="/en/banner/" hreflang="en">Die Banner auf Englisch</a></p>
  </div>
</section>
<section class="alt" id="einbinden">
  <div class="wrap">
    <p class="kicker">Einbinden</p>
    <h2>Das Bild liegt bei euch, der Link führt zu Kabine.</h2>
    <ol class="steps">
      <li>Banner herunterladen und auf eurer eigenen Website hochladen, zum Beispiel in die Mediathek von WordPress.</li>
      <li>Den Code unten einfügen und den Pfad im <code>src</code> (und <code>srcset</code>) durch die Adresse eurer Datei ersetzen.</li>
    </ol>
    <div class="snippet">
      <pre><code id="snippet-code">${code}</code></pre>
      <button type="button" class="btn primary copy" data-copy="snippet-code" hidden>Code kopieren</button>
    </div>
    <p class="sub">Bindet das Bild bitte nicht direkt von kabine.dev ein. Dann wäre es auf eurer Seite ein fremder Inhalt: Jeder Besuch eurer Website würde eine Anfrage an kabine.dev schicken, und ihr müsstet das in eurer Datenschutzerklärung erklären. Liegt das Bild bei euch, passiert beim Laden nichts außerhalb eurer Website. Erst wer auf den Banner klickt, besucht kabine.dev.</p>
  </div>
</section>`
    : `<section>
  <div class="wrap">
    <p class="kicker">Four formats</p>
    <h2>Ready to download.</h2>
    <p class="sub">All banners show the invented demo club “SV Musterstadt”, no real data. The small formats also come in double resolution for sharp screens. You may use them freely on your website and in your channels.</p>
    <div class="banner-grid">
${cards}
    </div>
    <p class="more"><a href="/banner/" hreflang="de">The banners in German</a></p>
  </div>
</section>
<section class="alt" id="embed">
  <div class="wrap">
    <p class="kicker">Embed</p>
    <h2>The image lives on your site, the link goes to Kabine.</h2>
    <ol class="steps">
      <li>Download a banner and upload it to your own website, for example to the WordPress media library.</li>
      <li>Paste the code below and replace the path in <code>src</code> (and <code>srcset</code>) with the address of your file.</li>
    </ol>
    <div class="snippet">
      <pre><code id="snippet-code">${code}</code></pre>
      <button type="button" class="btn primary copy" data-copy="snippet-code" hidden>Copy code</button>
    </div>
    <p class="sub">Please don’t load the image straight from kabine.dev. On your site it would then be a third-party resource: every visit to your website would send a request to kabine.dev, and you would have to cover that in your privacy policy. With the image on your own server nothing leaves your website while the page loads. Only people who click the banner visit kabine.dev.</p>
  </div>
</section>`;
  return {
    path: de ? "/banner/" : "/en/banner/",
    title: de ? "Banner für die Vereinswebsite – Kabine" : "Banners for your club website – Kabine",
    description: de
      ? "Banner „Wir nutzen Kabine“ für die Website und die Social-Media-Kanäle eures Vereins: vier Formate als PNG, mit Code zum Einbinden."
      : "“We use Kabine” banners for your club's website and social media: four formats as PNG, with code to embed them.",
    kicker: de ? "Für Vereine" : "For clubs",
    h1: de ? "Banner für eure <mark>Vereinswebsite</mark>." : "Banners for your <mark>club website</mark>.",
    lead: de
      ? "Euer Verein nutzt Kabine? Zeigt es Mitgliedern, Eltern und anderen Vereinen, mit einem Banner auf eurer Website oder einem Post in euren Kanälen."
      : "Your club uses Kabine? Show it to members, parents and other clubs, with a banner on your website or a post on your channels.",
    body: `${body}\n<script src="/copy.js" defer></script>`,
  };
}

/** The page in both languages, in the shape of the entries of PAGES (site/src/pages.mjs). */
export const bannerPage = () => ({ id: "banner", de: page("de"), en: page("en") });
