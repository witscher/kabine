// Renders the "We use Kabine" banners for club websites (site/src/banner/*.png, offered on kabine.dev/banner/)
// from the demo screenshots, German and English, with Playwright. Formats and texts: site/src/banners.mjs.
// Fonts and images are embedded as data URLs, so rendering needs no network and the PNGs no fonts.
// Run again after `npm run screenshots` or a change of the texts: npm run site:banners
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";
import { BANNER_FORMATS, BANNER_TEXT, bannerFile } from "../site/src/banners.mjs";

const out = "site/src/banner";
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const font = (pkg, file) => dataUrl(`node_modules/@fontsource/${pkg}/files/${file}`, "font/woff2");
const icon = readFileSync("site/src/icon.svg", "utf8").trim();
const check = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#FFD400"/><path d="M6.6 12.4l3.6 3.6 7.2-7.6" fill="none" stroke="#121212" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = `
@font-face { font-family: B; font-weight: 600; src: url(${font("barlow", "barlow-latin-600-normal.woff2")}); }
@font-face { font-family: B; font-weight: 700; src: url(${font("barlow", "barlow-latin-700-normal.woff2")}); }
@font-face { font-family: C; font-weight: 700; src: url(${font("barlow-condensed", "barlow-condensed-latin-700-normal.woff2")}); }
@font-face { font-family: C; font-weight: 800; src: url(${font("barlow-condensed", "barlow-condensed-latin-800-normal.woff2")}); }
html, body { margin: 0; padding: 0; }
.mo { position: relative; overflow: hidden; box-sizing: border-box; background: #ffd400; color: #121212; font-family: B; -webkit-font-smoothing: antialiased; }
.mo * { box-sizing: border-box; }
.brand { display: flex; align-items: center; gap: .45em; font-weight: 700; white-space: nowrap; line-height: 1; }
.brand svg { width: 1.7em; height: 1.7em; flex: none; }
.brand, h1, .sub { width: fit-content; }
h1 { margin: 0; font: 800 10px/.9 C; letter-spacing: -.01em; text-wrap: balance; }
.sub { margin: 0; font-weight: 600; line-height: 1.15; text-wrap: balance; }
.feats { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
.feats li { display: flex; align-items: center; gap: .35em; white-space: nowrap; background: #121212; color: #fff; border-radius: 999px;
  padding: .22em .75em .22em .35em; font: 700 10px/1 C; }
.feats svg { width: 1.05em; height: 1.05em; flex: none; }
.phone { position: absolute; background: #121212; padding: var(--bz); border-radius: calc(var(--bz) * 4.2); box-shadow: 0 2.2em 4em rgba(18, 18, 18, .28); }
.phone img { display: block; width: 100%; height: auto; border-radius: calc(var(--bz) * 3.2); }

/* Rectangle 300 × 250 */
.rectangle { width: 300px; height: 250px; padding: 18px 20px; display: flex; flex-direction: column; justify-content: center; }
.rectangle .brand { font-size: 17px; }
.rectangle h1 { font-size: 40px; margin-top: 14px; white-space: nowrap; }
.rectangle .sub { font-size: 15px; margin-top: 7px; }
.rectangle .feats { gap: 5px; margin-top: 12px; }
.rectangle .feats li { font-size: 14px; }

/* Wide 970 × 250 */
.wide { width: 970px; height: 250px; padding: 0 0 0 44px; display: flex; flex-direction: column; justify-content: center; }
.wide .brand { font-size: 21px; }
.wide h1 { font-size: 66px; margin-top: 16px; white-space: nowrap; }
.wide .sub { font-size: 24px; margin-top: 8px; white-space: nowrap; }
.wide .feats { gap: 10px; margin-top: 16px; }
.wide .feats li { font-size: 21px; }
.wide .phone { --bz: 7px; width: 196px; right: 60px; top: 26px; }

/* Square 1080 × 1080 */
.square { width: 1080px; height: 1080px; padding: 80px; }
.square .brand { font-size: 40px; }
.square h1 { font-size: 150px; margin-top: 64px; max-width: 520px; }
.square .sub { font-size: 42px; margin-top: 30px; max-width: 500px; }
.square .feats { flex-direction: column; align-items: flex-start; gap: 14px; margin-top: 40px; }
.square .feats li { font-size: 44px; }
.square .phone { --bz: 12px; width: 390px; right: 80px; top: 120px; }

/* Article 1200 × 630 */
.article { width: 1200px; height: 630px; padding: 64px; display: flex; flex-direction: column; justify-content: center; }
.article .brand { font-size: 32px; }
.article h1 { font-size: 112px; margin-top: 40px; max-width: 690px; }
.article .sub { font-size: 34px; margin-top: 20px; max-width: 690px; }
.article .feats { gap: 12px; margin-top: 30px; }
.article .feats li { font-size: 30px; }
.article .phone { --bz: 10px; width: 320px; right: 90px; top: 64px; }
`;

const LAYOUT = {
  rectangle: { phone: false },
  wide: { phone: true },
  square: { phone: true },
  article: { phone: true },
};

function banner(lang, f) {
  const t = BANNER_TEXT[lang];
  const shot = dataUrl(`docs/screenshots/${lang}/01-events.png`, "image/png");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="mo ${f.id}">
  <div class="brand">${icon}<span>kabine.dev</span></div>
  <h1>${t.headline}</h1>
  <p class="sub">${t.sub}</p>
  <ul class="feats">${t.feats.map((x) => `<li>${check}<span>${x}</span></li>`).join("")}</ul>
  ${LAYOUT[f.id].phone ? `<div class="phone"><img src="${shot}" alt=""></div>` : ""}
</div></body></html>`;
}

// Every text inside a safe zone of 5 % of the shorter side, not cut off, not under the phone
const inspect = (page) =>
  page.evaluate(() => {
    const mo = document.querySelector(".mo").getBoundingClientRect();
    const safe = Math.min(mo.width, mo.height) * 0.05;
    const phone = document.querySelector(".phone")?.getBoundingClientRect();
    const issues = [];
    for (const el of document.querySelectorAll(".brand, h1, .sub, .feats li")) {
      const r = el.getBoundingClientRect();
      const name = el.textContent.trim().slice(0, 30);
      if (r.left < safe || r.top < safe || r.right > mo.width - safe || r.bottom > mo.height - safe) issues.push(`${name}: outside the safe zone`);
      if (el.scrollWidth > el.clientWidth + 1) issues.push(`${name}: cut off`);
      if (phone && r.right > phone.left && r.left < phone.right && r.bottom > phone.top && r.top < phone.bottom) issues.push(`${name}: under the phone`);
    }
    return issues;
  });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const sizes = [];
for (const lang of ["de", "en"]) {
  for (const f of BANNER_FORMATS) {
    for (const scale of f.scales) {
      const context = await browser.newContext({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: scale });
      const page = await context.newPage();
      await page.setContent(banner(lang, f));
      await page.evaluate(() => document.fonts.ready);
      if (scale === 1) problems.push(...(await inspect(page)).map((p) => `${lang} ${f.w}×${f.h}: ${p}`));
      const png = await page.locator(".mo").screenshot();
      await context.close();
      // 256-colour palette: a third to a quarter of the size, no visible difference on flat colours and UI
      const file = bannerFile(lang, f, scale);
      const small = await sharp(png).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
      writeFileSync(`${out}/${file}`, small);
      sizes.push(`${file}: ${Math.round(small.length / 1024)} KB`);
    }
  }
}
await browser.close();
console.log(sizes.join("\n"));
if (problems.length) {
  console.error(`Layout problems:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Banners written to ${out}.`);
