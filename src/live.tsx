// Laufendes Spiel: Liveticker, danach Spielbericht bei handball4all in einem neuen Fenster. Die App fragt dafür
// erst beim Antippen einmal den Spielplan der Mannschaft ab (vom Gerät, ohne Cookies und
// Referrer), liest daraus Ticker-Schlüssel bzw. Berichtsnummer des Spiels und öffnet die Seite.
// Kein regelmäßiger Abruf, nichts wird gespeichert (Entscheidung des Vereins, 11.10.2026).
import { useState } from "preact/hooks";
import type { EventSummary } from "../shared/types";
import { nowLocal, time } from "./format";
import { Ball, Icon } from "./icons";
import { toast } from "./ui";

const TICKER_URL = "https://spo.handball4all.de/service/ticker/index.html?token=";
const REPORT_URL = "https://spo.handball4all.de/misc/sboPublicReports.php?sGID=";
/** So lange nach Anpfiff gibt es den Knopf „Spielbericht“. */
const REPORT_DAYS = 7;

/** Minuten seit Anpfiff (beide Zeiten Berliner Ortszeit; als UTC gelesen stimmt der Abstand bis auf die Zeitumstellung). */
function minutesSince(e: EventSummary, nowLocalTime: string): number {
  return (Date.parse(`${nowLocalTime}:00Z`) - Date.parse(`${e.startsAt}:00Z`)) / 60_000;
}

/** Läuft das Spiel gerade (angepfiffen, Spieldauer laut Altersklasse) und gibt es eine Seite bei handball4all? */
export function isLiveWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !(e.game?.liveUrl || e.game?.tableUrl)) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= 0 && since < e.game.liveMinutes;
}

/** Nach dem Spiel (bis 7 Tage) den Spielbericht anbieten; nur bei Spielen aus handball4all. */
export function isReportWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !e.game?.liveUrl || !e.game.h4aGameId) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= e.game.liveMinutes && since < REPORT_DAYS * 24 * 60;
}

type H4aGame = Record<string, unknown>;

/** Eintrag des Spiels irgendwo im Spielplan-JSON suchen. */
export function findGame(data: unknown, gameId: string): H4aGame | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown): H4aGame | null => {
    if (!v || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    const o = v as H4aGame;
    if ("gID" in o && String(o.gID) === gameId) return o;
    for (const x of Object.values(o)) {
      const g = walk(x);
      if (g) return g;
    }
    return null;
  };
  return walk(data);
}

/** Ticker-Schlüssel (gToken) des Spiels. */
export function tickerUrl(g: H4aGame | null): string | null {
  const t = g?.gToken;
  return typeof t === "string" && /^[0-9a-f]{16,64}$/i.test(t) ? TICKER_URL + encodeURIComponent(t) : null;
}

/** Spielbericht (sGID), sobald veröffentlicht; vorher ist sGID 0. */
export function reportUrl(g: H4aGame | null): string | null {
  const id = String(g?.sGID ?? "");
  return /^[1-9][0-9]{0,11}$/.test(id) ? REPORT_URL + id : null;
}

/** Spielplan der Mannschaft einmal abrufen (vom Gerät, ohne Cookies und Referrer) und den Eintrag des Spiels liefern. */
async function fetchGame(event: EventSummary): Promise<H4aGame | null> {
  const g = event.game!;
  if (!g.liveUrl || !g.h4aGameId) return null;
  try {
    const res = await fetch(g.liveUrl, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    return res.ok ? findGame(await res.json(), g.h4aGameId) : null;
  } catch {
    return null;
  }
}

/** Im neuen Fenster selbst navigieren, damit handball4all keinen Referrer der App sieht. Ohne Ziel nur der Hinweis. */
function navigate(w: Window, url: string | null, note: string | null) {
  const d = w.document;
  d.body.textContent = "";
  if (note) {
    const p = d.createElement("p");
    p.textContent = note;
    d.body.appendChild(p);
  }
  if (!url) return;
  const a = d.createElement("a");
  a.href = url;
  a.rel = "noreferrer";
  a.textContent = "Weiter zu handball4all";
  d.body.appendChild(a);
  if (!note) a.click();
  else w.setTimeout(() => a.click(), 2500);
}

/** Fenster sofort beim Antippen öffnen (sonst blockieren Browser es als Popup), dann das Ziel nachladen. */
function useH4aWindow(title: string, resolve: (g: H4aGame | null) => { url: string | null; note: string | null }) {
  const [busy, setBusy] = useState(false);
  const open = async (event: EventSummary) => {
    const w = window.open("", "_blank");
    if (!w) {
      toast("Das Fenster wurde blockiert. Bitte Pop-ups für die App erlauben.", "error");
      return;
    }
    w.opener = null;
    w.document.write(
      `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><p>${title} wird geöffnet …</p></body></html>`,
    );
    w.document.close();
    setBusy(true);
    try {
      const { url, note } = resolve(await fetchGame(event));
      navigate(w, url, note);
    } finally {
      setBusy(false);
    }
  };
  return { busy, open };
}

/** Knopf zum Liveticker; öffnet sofort ein neues Fenster und leitet es zur Tickerseite weiter. */
export function LiveTickerLink({ event }: { event: EventSummary }) {
  const { busy, open } = useH4aWindow("Liveticker", (g) => {
    const url = tickerUrl(g);
    return url
      ? { url, note: null }
      : { url: event.game?.tableUrl ?? null, note: "Den Liveticker zu diesem Spiel gibt es (noch) nicht. Du kommst zur Seite der Mannschaft bei handball4all." };
  });
  if (!event.game?.liveUrl && !event.game?.tableUrl) return null;
  return (
    <button type="button" class="btn btn-primary" onClick={() => open(event)} disabled={busy}>
      <Icon name="link" size={18} />
      Liveticker bei handball4all
    </button>
  );
}

/** Knopf zum Spielbericht; handball4all veröffentlicht ihn etwa 20 bis 30 Minuten nach Spielende. */
export function GameReportLink({ event }: { event: EventSummary }) {
  const { busy, open } = useH4aWindow("Spielbericht", (g) => {
    const url = reportUrl(g);
    return url ? { url, note: null } : { url: null, note: "Der Spielbericht ist noch nicht veröffentlicht. handball4all stellt ihn meist 20 bis 30 Minuten nach Spielende online. Bitte später noch einmal versuchen." };
  });
  return (
    <button type="button" class="btn" onClick={() => open(event)} disabled={busy}>
      <Icon name="link" size={18} />
      Spielbericht bei handball4all
    </button>
  );
}

/** Große Karte für ein laufendes Spiel. */
export function LiveCard({ event }: { event: EventSummary }) {
  const g = event.game!;
  return (
    <section class="card live-card" aria-label="Spiel läuft gerade">
      <div class="card-head">
        <span class="label">Läuft gerade · Spiel</span>
        <span class="live-badge on">Live</span>
      </div>
      <div class="card-body has-ball stack-sm">
        <Ball class="next-ball" />
        <a href={`/termine/${event.id}`} style={{ textDecoration: "none" }}>
          <div style={{ fontWeight: 700, fontSize: "18px" }}>
            {g.homeTeam ?? "Heim"} – {g.guestTeam ?? "Gast"}
          </div>
          <div class="small muted">Anpfiff {time(event.startsAt)} Uhr</div>
        </a>
        <LiveTickerLink event={event} />
        <p class="small muted">Der Liveticker öffnet sich in einem neuen Fenster bei handball4all.</p>
      </div>
    </section>
  );
}
