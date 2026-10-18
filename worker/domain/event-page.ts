// Terminübersicht seitenweise („Mehr Termine“). Der Server filtert, was früher der Browser
// gefiltert hat (Relevanz, Mannschaft), und liefert nur die nächsten `limit` Termine. Geprüft
// und mit Details geladen werden dabei nur diese, nicht alle Termine der Saison.
// Siehe docs/entscheidungen.md, Datenbank-Leselast.
import { isRelevantEvent } from "../../shared/relevance";
import type { EventPage, EventSummary } from "../../shared/types";
import type { Actor } from "../auth/actor";
import { all, list } from "../lib/db";
import { addDays, nowLocal, todayLocal } from "../lib/time";
import { loadCarpoolCounts } from "./carpool";
import { dutyManagers, loadHelpersNeeded, loadMyDuties } from "./duties";
import {
  type EventContext,
  type EventCursor,
  type EventRow,
  loadEventContext,
  loadVisibleEvent,
  mergeContexts,
  toSummary,
  visibleEventBatch,
} from "./events";
import { HORIZON_DAYS } from "./generate";

/** So weit sucht der Server nach dem nächsten eigenen Termin für die große Karte (wie früher die 70 Tage). */
const NEXT_CARD_DAYS = 70;
/** Etwas mehr Termine prüfen als nötig, falls einzelne nicht relevant sind. */
const MARGIN = 10;

interface Item {
  row: EventRow;
  summary: EventSummary;
}

/** Zusammenfassung mit eigenen Diensten und Organisatoren, ohne Helferbedarf und Fahrgemeinschaften. */
async function summarize(db: D1Database, actor: Actor, rows: EventRow[], now: number): Promise<{ ctx: EventContext; items: Item[] }> {
  const [ctx, duties, managers] = await Promise.all([
    loadEventContext(db, rows),
    loadMyDuties(
      db,
      actor,
      rows.filter((e) => e.kind !== "training").map((e) => e.id),
    ),
    dutyManagers(
      db,
      rows.filter((e) => e.kind === "special").map((e) => e.id),
    ),
  ]);
  const items = rows.map((row) => ({
    row,
    summary: { ...toSummary(row, ctx, actor, now), myDuties: duties.get(row.id) ?? [], organizing: !!managers.get(row.id)?.has(actor.personId) },
  }));
  return { ctx, items };
}

/** Termin für die große Karte („Dein nächster Termin“), wie in der Terminübersicht. */
function nextCardCandidate(s: EventSummary): boolean {
  return !s.cancelled && s.mine.some((m) => m.participant || m.helpRequest?.status === "open");
}

const day = (s: EventSummary) => s.startsAt.slice(0, 10);

/**
 * Termine ab `from` (bis `to`), an denen man selbst oder ein Kind als Spieler, Aushilfe,
 * Nominierte oder Angefragte beteiligt ist: Anwärter für die große Karte. Nur IDs; ob die Eltern
 * zuständig sind und ob es wirklich ein eigener Termin ist, entscheidet danach die Zusammenfassung.
 */
export async function ownCandidates(db: D1Database, actor: Actor, from: string, to: string): Promise<number[]> {
  const people = list([actor.personId, ...actor.children.map((c) => c.id)]);
  const rows = await all<{ id: number }>(
    db,
    `WITH own(id) AS MATERIALIZED (
       SELECT et.event_id FROM team_memberships tm JOIN event_teams et ON et.team_id = tm.team_id
        WHERE tm.person_id IN (SELECT value FROM json_each(?1)) AND tm.role IN ('player', 'helper')
       UNION SELECT event_id FROM nominations WHERE person_id IN (SELECT value FROM json_each(?1))
       UNION SELECT event_id FROM help_requests WHERE person_id IN (SELECT value FROM json_each(?1)) AND status = 'open'
     )
     SELECT e.id FROM own CROSS JOIN events e ON e.id = own.id
      WHERE e.starts_at >= ?2 AND e.starts_at < ?3 AND e.cancelled_at IS NULL
      ORDER BY e.starts_at, e.id LIMIT 30`,
    people,
    from,
    to,
  );
  return rows.map((r) => r.id);
}

export async function loadEventPage(db: D1Database, actor: Actor, opts: { limit: number; past: boolean; teamId: number | null }): Promise<EventPage> {
  const now = Date.now();
  const nowL = nowLocal();
  const today = todayLocal();
  const fits = (s: EventSummary) => isRelevantEvent(s) && (opts.teamId == null || s.teams.some((t) => t.id === opts.teamId));
  // Ohne oberes Datum: Termine gibt es nur aus der laufenden Saison, der Saisonwechsel löscht die alten
  const range = opts.past
    ? { from: "0000-01-01T00:00", to: nowL, desc: true }
    : { from: `${today}T00:00`, to: "9999-12-31T00:00", desc: false };
  const cap = `${addDays(today, NEXT_CARD_DAYS)}T00:00`;

  const page: Item[] = [];
  const live: Item[] = [];
  let ctx: EventContext | null = null;
  let after: EventCursor | null = null;
  let hasMore = false;
  let done = false;
  while (!done && !hasMore) {
    const batch = await visibleEventBatch(db, actor, { ...range, size: Math.max(opts.limit + 1 - page.length, 0) + MARGIN, after });
    after = batch.last;
    done = batch.done;
    const part = await summarize(db, actor, batch.rows, now);
    ctx = ctx ? mergeContexts(ctx, part.ctx) : part.ctx;
    for (const item of part.items) {
      const s = item.summary;
      if (!fits(s)) continue;
      if (opts.past) {
        if (!s.isPast) continue;
        if (page.length < opts.limit) page.push(item);
        else hasMore = true;
      } else if (s.isPast) {
        // Heute schon angepfiffen: für die Live-Karte, ob das Fenster noch läuft, prüft die App
        if (s.kind === "game" && !s.cancelled) live.push(item);
        continue;
      } else {
        const last = page.at(-1)?.summary;
        if (page.length < opts.limit || (!!last && day(s) === day(last))) page.push(item);
        else hasMore = true;
      }
      if (hasMore) break;
    }
  }

  // Große Karte: Liegt der nächste eigene Termin hinter der Seite, kommt er gezielt dazu (höchstens 70 Tage)
  let next: Item[] = [];
  if (!opts.past && !page.some((i) => nextCardCandidate(i.summary))) {
    const known = new Set([...page, ...live].map((i) => i.row.id));
    const from = page.at(-1)?.summary.startsAt ?? nowL;
    const own = (await ownCandidates(db, actor, from, cap)).filter((id) => !known.has(id));
    for (let i = 0; i < own.length && !next.length; i += 6) {
      const rows = (await Promise.all(own.slice(i, i + 6).map((id) => loadVisibleEvent(db, actor, id)))).filter((r): r is EventRow => !!r);
      const part = await summarize(db, actor, rows, now);
      const hits = part.items.filter((x) => fits(x.summary) && nextCardCandidate(x.summary));
      if (!hits.length) continue;
      ctx = ctx ? mergeContexts(ctx, part.ctx) : part.ctx;
      // Weitere eigene Termine am selben Tag (zwei Spiele an einem Sonntag)
      next = hits.filter((x) => day(x.summary) === day(hits[0]!.summary));
    }
  }

  // Offene Aushilfe-Anfragen an einen selbst oder die Kinder, auch jenseits der Seite (Karten oben)
  let openHelp: Item[] = [];
  if (!opts.past) {
    const ids = await all<{ event_id: number }>(
      db,
      `SELECT h.event_id FROM help_requests h JOIN events e ON e.id = h.event_id
        WHERE h.status = 'open' AND h.person_id IN (SELECT value FROM json_each(?)) AND e.starts_at >= ?`,
      list([actor.personId, ...actor.children.map((c) => c.id)]),
      `${today}T00:00`,
    );
    const known = new Map([...page, ...live, ...next].map((i) => [i.row.id, i]));
    const missing = [...new Set(ids.map((r) => r.event_id))].filter((id) => !known.has(id));
    const rows = (await Promise.all(missing.map((id) => loadVisibleEvent(db, actor, id)))).filter((r): r is EventRow => !!r);
    const extra = rows.length ? await summarize(db, actor, rows, now) : null;
    if (extra) ctx = ctx ? mergeContexts(ctx, extra.ctx) : extra.ctx;
    openHelp = [...known.values(), ...(extra?.items ?? [])]
      .filter((i) => fits(i.summary) && !i.summary.isPast && i.summary.mine.some((m) => m.helpRequest?.status === "open"))
      .sort((a, b) => a.summary.startsAt.localeCompare(b.summary.startsAt) || a.row.id - b.row.id);
  }

  // Helferbedarf und Fahrgemeinschaften nur für das, was die App zeigt
  const shown = [...new Map([...page, ...live, ...next, ...openHelp].map((i) => [i.row.id, i.row])).values()];
  const [needed, carpool] =
    opts.past || !ctx
      ? [new Map<number, number>(), new Map<number, { taken: number; seats: number; waiting: number }>()]
      : await Promise.all([
          loadHelpersNeeded(
            db,
            actor,
            shown.filter((e) => e.kind !== "training").map((e) => e.id),
            nowL,
          ),
          loadCarpoolCounts(db, actor, shown, ctx, now),
        ]);
  const finish = ({ row, summary }: Item): EventSummary => ({
    ...summary,
    // Wer (oder wessen Familie) schon einen Dienst hat, bekommt keinen Aufruf
    helpersNeeded: summary.myDuties.length ? 0 : (needed.get(row.id) ?? 0),
    carpoolCount: carpool.get(row.id) ?? null,
  });
  return {
    events: page.map(finish),
    hasMore,
    live: live.map(finish),
    next: next.map(finish),
    openHelp: openHelp.map(finish),
    trainingsUntil: opts.past ? null : addDays(today, HORIZON_DAYS),
  };
}
