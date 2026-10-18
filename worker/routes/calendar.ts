// Personal calendar (Profile → My events): secret subscription link per account with checkboxes
// for training, games and helper duties. The link shows the same events as the app.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { isRelevantEvent } from "../../shared/relevance";
import { type AppEnv, requireActor } from "../app";
import { type ActorRow, buildActor } from "../auth/actor";
import { installId, loadClub } from "../domain/club";
import { buildCalendar, type CalendarDuty, calendarItems, type CalendarPrefs } from "../domain/calendar";
import { listVisibleEvents, loadEventContext, toSummary } from "../domain/events";
import { b64url, randomBytes, sha256Hex } from "../lib/crypto";
import { all, first, run } from "../lib/db";
import { notFound, parse, readJson } from "../lib/http";
import { addDays, todayLocal } from "../lib/time";
import { currentLocale, withLocale } from "../i18n";

export const calendarRoutes = new Hono<AppEnv>();

/** Range of the calendar: one month back, half a year ahead. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

const DEFAULT_PREFS: CalendarPrefs = { training: true, games: true, duties: true };

interface PrefsRow {
  training: number;
  games: number;
  duties: number;
}

const toPrefs = (r: PrefsRow): CalendarPrefs => ({ training: r.training === 1, games: r.games === 1, duties: r.duties === 1 });

calendarRoutes.get("/profile/calendar", async (c) => {
  const actor = requireActor(c);
  const row = await first<PrefsRow>(c.env.DB, "SELECT training, games, duties FROM calendar_tokens WHERE account_id = ?", actor.accountId);
  return c.json({ hasCalendar: !!row, ...(row ? toPrefs(row) : DEFAULT_PREFS) });
});

const prefsSchema = z.object({ training: z.boolean(), games: z.boolean(), duties: z.boolean() });

calendarRoutes.put("/profile/calendar", async (c) => {
  const actor = requireActor(c);
  const p = parse(prefsSchema, await readJson(c.req.raw));
  const res = await run(
    c.env.DB,
    "UPDATE calendar_tokens SET training = ?, games = ?, duties = ? WHERE account_id = ?",
    p.training ? 1 : 0,
    p.games ? 1 : 0,
    p.duties ? 1 : 0,
    actor.accountId,
  );
  if (!res.meta.changes) throw notFound(t`You do not have a calendar link yet.`);
  return c.json({ ok: true });
});

/** New calendar link (the old one becomes invalid). The token is only in this response. */
calendarRoutes.post("/profile/calendar-token", async (c) => {
  const actor = requireActor(c);
  const p = parse(prefsSchema.partial(), await readJson(c.req.raw).catch(() => ({})));
  const prefs = { ...DEFAULT_PREFS, ...p };
  const token = b64url(randomBytes(24));
  await run(
    c.env.DB,
    `INSERT INTO calendar_tokens (account_id, token_hash, training, games, duties) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (account_id) DO UPDATE SET token_hash = excluded.token_hash, training = excluded.training, games = excluded.games,
       duties = excluded.duties, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    actor.accountId,
    await sha256Hex(token),
    prefs.training ? 1 : 0,
    prefs.games ? 1 : 0,
    prefs.duties ? 1 : 0,
  );
  const origin = c.env.ORIGIN || new URL(c.req.url).origin;
  return c.json({ url: `${origin}/api/calendar/${token}.ics` });
});

calendarRoutes.delete("/profile/calendar-token", async (c) => {
  const actor = requireActor(c);
  await run(c.env.DB, "DELETE FROM calendar_tokens WHERE account_id = ?", actor.accountId);
  return c.json({ ok: true });
});

/** Calendar subscription without sign-in, only with the secret link. */
calendarRoutes.get("/calendar/:file", async (c) => {
  const file = c.req.param("file");
  const token = file.endsWith(".ics") ? file.slice(0, -4) : file;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound();
  const db = c.env.DB;
  const row = await first<ActorRow & PrefsRow & { locale: string | null }>(
    db,
    `SELECT a.id AS account_id, p.id AS person_id, p.first_name, p.last_name, p.is_admin, ct.training, ct.games, ct.duties, a.locale
       FROM calendar_tokens ct JOIN accounts a ON a.id = ct.account_id AND a.disabled_at IS NULL
       JOIN persons p ON p.id = a.person_id AND p.is_former = 0
      WHERE ct.token_hash = ?`,
    await sha256Hex(token),
  );
  if (!row) throw notFound();
  // Fetched without a session: texts in the language of the calendar owner's account
  return withLocale(row.locale ?? currentLocale(), () => calendarFeed(c.env, db, row, new URL(c.req.url).origin));
});

async function calendarFeed(env: Env, db: D1Database, row: ActorRow & PrefsRow, requestOrigin: string): Promise<Response> {
  const prefs = toPrefs(row);
  const from = `${addDays(todayLocal(), -PAST_DAYS)}T00:00`;
  const to = `${addDays(todayLocal(), FUTURE_DAYS)}T00:00`;

  // Visibility and parent rules exactly as in the app: actor of the account
  const now = Date.now();
  const actor = await buildActor(db, { id: "calendar", account_id: row.account_id, created_at: "", expires_at: "", extended_at: "" }, row);
  let events: ReturnType<typeof toSummary>[] = [];
  if (prefs.training || prefs.games) {
    const rows = await listVisibleEvents(db, actor, { from, to });
    const ctx = await loadEventContext(db, rows);
    // myDuties stays empty: duties come as separate entries, a game with only a duty does not belong to "games"
    events = rows.map((e) => toSummary(e, ctx, actor, now)).filter(isRelevantEvent);
  }

  let duties: CalendarDuty[] = [];
  if (prefs.duties) {
    const rows = await all<{
      id: number;
      label: string;
      mode: "onsite" | "task";
      block_start: string;
      block_end: string;
      note: string | null;
      child_name: string | null;
      starts_at: string;
      ends_at: string | null;
      is_home: number | null;
      home_team: string | null;
      guest_team: string | null;
      title: string | null;
      cancelled_at: string | null;
      location: string | null;
      address: string | null;
      team_name: string | null;
    }>(
      db,
      `SELECT d.id, dt.name AS label, dt.mode, ed.starts_at AS block_start, ed.ends_at AS block_end, d.note, ch.first_name AS child_name, e.starts_at, e.ends_at, e.is_home, e.home_team, e.guest_team, e.title, e.cancelled_at,
              l.name AS location, l.address,
              (SELECT t.name FROM event_teams et JOIN teams t ON t.id = et.team_id WHERE et.event_id = e.id ORDER BY t.id LIMIT 1) AS team_name
         FROM duties d JOIN events e ON e.id = d.event_id JOIN event_duties ed ON ed.id = d.event_duty_id JOIN duty_types dt ON dt.id = d.duty_type_id
         LEFT JOIN persons ch ON ch.id = d.child_id
         LEFT JOIN locations l ON l.id = e.location_id
        WHERE d.person_id = ? AND e.starts_at >= ? AND e.starts_at < ?
        ORDER BY e.starts_at`,
      row.person_id,
      from,
      to,
    );
    duties = rows.map((r) => ({
      id: r.id,
      label: r.label,
      task: r.mode === "task",
      childName: r.child_name,
      note: r.note,
      startsAt: r.block_start,
      endsAt: r.block_end,
      cancelled: r.cancelled_at != null,
      location: [r.location, r.address].filter(Boolean).join(", ") || null,
      teamName: r.team_name,
      isHome: r.is_home == null ? null : r.is_home === 1,
      homeTeam: r.home_team,
      guestTeam: r.guest_team,
      title: r.title,
    }));
  }

  const origin = env.ORIGIN || requestOrigin;
  const [club, install] = await Promise.all([loadClub(db), installId(db)]);
  const items = calendarItems(events, duties, prefs, { selfId: row.person_id, coachTeamIds: actor.coachTeamIds, origin, uidHost: `${install}.kabine` });
  return new Response(buildCalendar(club.shortName, items, new Date().toISOString()), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="kabine.ics"',
      "cache-control": "private, max-age=300",
    },
  });
}
