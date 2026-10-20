// Renders the share images of kabine.dev (site/src/og-de.png, og-en.png, 1200×630) from the demo
// screenshots, in the look of the website. Run again after `npm run screenshots`: npm run site:og
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`).toString("base64")}`;
const shot = (lang, file) => `data:image/png;base64,${readFileSync(`docs/screenshots/${lang}/${file}`).toString("base64")}`;
const icon = `data:image/svg+xml;base64,${readFileSync("site/src/icon.svg").toString("base64")}`;

const TEXT = {
  de: { eyebrow: "Frei · Open Source · für jeden Verein", h1: "Die kostenlose Mannschafts-App für Vereine.", sub: "Zu- und Absagen · Kader · Chat · Helferdienste · Fahrgemeinschaften" },
  en: { eyebrow: "Free · open source · for every club", h1: "The free team app for sports clubs.", sub: "Responses · squads · chat · helper duties · carpools" },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const lang of ["de", "en"]) {
  const t = TEXT[lang];
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: B; font-weight: 600; src: url(${font("barlow", "barlow-latin-600-normal.woff2")}); }
    @font-face { font-family: C; font-weight: 800; src: url(${font("barlow-condensed", "barlow-condensed-latin-800-normal.woff2")}); }
    body { margin: 0; width: 1200px; height: 630px; background: #121212; color: #fff; font-family: B; overflow: hidden; display: grid; grid-template-columns: 640px 1fr; }
    .text { padding: 64px 0 0 72px; }
    .brand { display: flex; align-items: center; gap: 14px; font: 800 44px/1 C; letter-spacing: 0.04em; text-transform: uppercase; }
    .brand img { width: 52px; height: 52px; border-radius: 12px; }
    .eyebrow { margin-top: 56px; font: 800 24px/1 C; letter-spacing: 0.14em; text-transform: uppercase; color: #ffd400; }
    h1 { margin: 18px 0 0; font: 800 76px/0.98 C; }
    .sub { margin-top: 26px; font-size: 24px; color: #d6d2c6; }
    .shots { display: flex; gap: 22px; transform: rotate(4deg); margin-top: 40px; }
    .shots img { width: 250px; border-radius: 26px; border: 1px solid #333; box-shadow: 0 18px 40px rgba(0,0,0,.5); }
    .shots img:nth-child(2) { margin-top: 60px; }
    .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; background: #ffd400; }
  </style></head><body>
    <div class="text"><div class="brand"><img src="${icon}">Kabine</div><div class="eyebrow">${t.eyebrow}</div><h1>${t.h1}</h1><div class="sub">${t.sub}</div></div>
    <div class="shots"><img src="${shot(lang, "01-events.png")}"><img src="${shot(lang, "03-coach-responses.png")}"></div>
    <div class="bar"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `site/src/og-${lang}.png` });
}
await browser.close();
console.log("Share images written to site/src/og-de.png and og-en.png.");
