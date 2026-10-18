// Game in progress: live ticker, afterwards the game report on handball4all in a new window. Only when tapped
// does the app fetch the team's fixture list once (from the device, without cookies and
// referrer), read the game's ticker key or report number from it and open the page.
// No regular polling, nothing is stored (club decision, 11.10.2026).
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import type { EventSummary } from "../shared/types";
import { nowLocal, time } from "./format";
import { currentLocale } from "./i18n";
import { Ball, Icon } from "./icons";
import { toast } from "./ui";

const TICKER_URL = "https://spo.handball4all.de/service/ticker/index.html?token=";
const REPORT_URL = "https://spo.handball4all.de/misc/sboPublicReports.php?sGID=";
/** For this long after kick-off there is the "Game report" button. */
const REPORT_DAYS = 7;

/** Minutes since kick-off (both times Berlin local time; read as UTC the difference is right except across a DST change). */
function minutesSince(e: EventSummary, nowLocalTime: string): number {
  return (Date.parse(`${nowLocalTime}:00Z`) - Date.parse(`${e.startsAt}:00Z`)) / 60_000;
}

/** Is the game in progress (kicked off, duration by age group) and is there a page on handball4all? */
export function isLiveWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !(e.game?.liveUrl || e.game?.tableUrl)) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= 0 && since < e.game.liveMinutes;
}

/** After the game (up to 7 days) offer the game report; only for games from handball4all. */
export function isReportWindow(e: EventSummary, nowLocalTime = nowLocal()): boolean {
  if (e.kind !== "game" || e.cancelled || !e.game?.liveUrl || !e.game.h4aGameId) return false;
  const since = minutesSince(e, nowLocalTime);
  return since >= e.game.liveMinutes && since < REPORT_DAYS * 24 * 60;
}

type H4aGame = Record<string, unknown>;

/** Find the game's entry anywhere in the fixture list JSON. */
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

/** Ticker key (gToken) of the game. */
export function tickerUrl(g: H4aGame | null): string | null {
  const token = g?.gToken;
  return typeof token === "string" && /^[0-9a-f]{16,64}$/i.test(token) ? TICKER_URL + encodeURIComponent(token) : null;
}

/** Game report (sGID) once published; before that sGID is 0. */
export function reportUrl(g: H4aGame | null): string | null {
  const id = String(g?.sGID ?? "");
  return /^[1-9][0-9]{0,11}$/.test(id) ? REPORT_URL + id : null;
}

/** Fetch the team's fixture list once (from the device, without cookies and referrer) and return the game's entry. */
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

/** Navigate within the new window so handball4all sees no referrer from the app. Without a target only the note. */
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
  a.textContent = t`Continue to handball4all`;
  d.body.appendChild(a);
  if (!note) a.click();
  else w.setTimeout(() => a.click(), 2500);
}

/** Open the window right on tap (otherwise browsers block it as a pop-up), then load the target. */
function useH4aWindow(title: string, resolve: (g: H4aGame | null) => { url: string | null; note: string | null }) {
  const [busy, setBusy] = useState(false);
  const open = async (event: EventSummary) => {
    const w = window.open("", "_blank");
    if (!w) {
      toast(t`The window was blocked. Please allow pop-ups for the app.`, "error");
      return;
    }
    w.opener = null;
    const opening = t`Opening ${title} …`;
    w.document.write(
      `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><p>${opening}</p></body></html>`,
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

/** Button to the live ticker; opens a new window right away and forwards it to the ticker page. */
export function LiveTickerLink({ event }: { event: EventSummary }) {
  const { busy, open } = useH4aWindow(t`Live ticker`, (g) => {
    const url = tickerUrl(g);
    return url
      ? { url, note: null }
      : { url: event.game?.tableUrl ?? null, note: t`There is no live ticker for this game (yet). You will be taken to the team's page on handball4all.` };
  });
  if (!event.game?.liveUrl && !event.game?.tableUrl) return null;
  return (
    <button type="button" class="btn btn-primary" onClick={() => open(event)} disabled={busy}>
      <Icon name="link" size={18} />
      <Trans>Live ticker on handball4all</Trans>
    </button>
  );
}

/** Button to the game report; handball4all publishes it about 20 to 30 minutes after the final whistle. */
export function GameReportLink({ event }: { event: EventSummary }) {
  const { busy, open } = useH4aWindow(t`Game report`, (g) => {
    const url = reportUrl(g);
    return url ? { url, note: null } : { url: null, note: t`The game report has not been published yet. handball4all usually puts it online 20 to 30 minutes after the final whistle. Please try again later.` };
  });
  return (
    <button type="button" class="btn" onClick={() => open(event)} disabled={busy}>
      <Icon name="link" size={18} />
      <Trans>Game report on handball4all</Trans>
    </button>
  );
}

/** Large card for a game in progress. */
export function LiveCard({ event }: { event: EventSummary }) {
  const g = event.game!;
  const home = g.homeTeam ?? t({ message: "Home", context: "home team" });
  const guest = g.guestTeam ?? t({ message: "Away", context: "away team" });
  const kickoff = time(event.startsAt);
  return (
    <section class="card live-card" aria-label={t`Game in progress`}>
      <div class="card-head">
        <span class="label">
          <Trans>In progress · Game</Trans>
        </span>
        <span class="live-badge on">
          <Trans>Live</Trans>
        </span>
      </div>
      <div class="card-body has-ball stack-sm">
        <Ball class="next-ball" />
        <a href={`/termine/${event.id}`} style={{ textDecoration: "none" }}>
          <div style={{ fontWeight: 700, fontSize: "18px" }}>
            {home} – {guest}
          </div>
          <div class="small muted">
            <Trans>Kick-off {kickoff}</Trans>
          </div>
        </a>
        <LiveTickerLink event={event} />
        <p class="small muted">
          <Trans>The live ticker opens in a new window on handball4all.</Trans>
        </p>
      </div>
    </section>
  );
}
