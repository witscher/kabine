// Erzeugt Einzeltermine aus Trainingsplänen, rollierend für die nächsten
// zehn Wochen. Idempotent: kann jederzeit erneut laufen.
//
// Regeln:
//   * Pro Regel und Datum genau ein Termin, auch bei gemeinsamen Trainings.
//   * Ein Ferienplan einer Mannschaft hat in seinem Zeitraum Vorrang vor ihrem
//     regulären Plan. Ein Ferienplan ohne Regeln bedeutet Trainingspause.
//   * Manuell geänderte Termine (is_detached) werden nicht angefasst.
//   * Nur zukünftige Termine werden geändert oder gelöscht.
//   * Gleiches Datum, andere Uhrzeit oder Halle: Termin wird angepasst,
//     Rückmeldungen bleiben erhalten. Entfällt ein Datum, wird der Termin samt
//     Rückmeldungen gelöscht.

import { all, batch, first, list, run, stmt } from "../lib/db";
import { addDays, eachDay, isoWeekday, nowLocal, todayLocal } from "../lib/time";

export const HORIZON_DAYS = 70;

interface PlanRow {
  id: number;
  team_id: number;
  kind: "regular" | "holiday";
  valid_from: string;
  valid_to: string;
}

interface RuleRow {
  id: number;
  plan_id: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location_id: number;
}

interface ExistingRow {
  id: number;
  rule_id: number;
  rule_date: string;
  starts_at: string;
  ends_at: string | null;
  location_id: number | null;
  is_detached: number;
  cancelled_at: string | null;
  team_ids: string | null;
}

export interface Occurrence {
  ruleId: number;
  date: string;
  startsAt: string;
  endsAt: string;
  locationId: number;
  teamIds: number[];
}

export interface GenerationResult {
  created: number;
  updated: number;
  deleted: number;
  /** Geänderte Termine (Uhrzeit/Ort) für Benachrichtigungen. */
  changedEventIds: number[];
}

/** Gewünschte Termine aus Plänen und Regeln (rein, ohne Datenbank). */
export function plannedOccurrences(
  plans: PlanRow[],
  rules: RuleRow[],
  ruleTeams: Map<number, number[]>,
  from: string,
  to: string,
  nowL: string,
): Map<string, Occurrence> {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const holidayPlansByTeam = new Map<number, PlanRow[]>();
  for (const p of plans) {
    if (p.kind !== "holiday") continue;
    holidayPlansByTeam.set(p.team_id, [...(holidayPlansByTeam.get(p.team_id) ?? []), p]);
  }
  const out = new Map<string, Occurrence>();
  for (const rule of rules) {
    const plan = planById.get(rule.plan_id);
    if (!plan) continue;
    const start = plan.valid_from > from ? plan.valid_from : from;
    const end = plan.valid_to < to ? plan.valid_to : to;
    if (start > end) continue;
    const teamIds = ruleTeams.get(rule.id)?.length ? ruleTeams.get(rule.id)! : [plan.team_id];
    for (const day of eachDay(start, end)) {
      if (isoWeekday(day) !== rule.weekday) continue;
      if (plan.kind === "regular") {
        const holidays = holidayPlansByTeam.get(plan.team_id) ?? [];
        if (holidays.some((h) => h.valid_from <= day && day <= h.valid_to)) continue;
      }
      const startsAt = `${day}T${rule.starts_at}`;
      if (startsAt <= nowL) continue;
      out.set(`${rule.id}|${day}`, {
        ruleId: rule.id,
        date: day,
        startsAt,
        endsAt: `${day}T${rule.ends_at}`,
        locationId: rule.location_id,
        teamIds: [...teamIds].sort((a, b) => a - b),
      });
    }
  }
  return out;
}

export async function generateTrainings(db: D1Database, now = Date.now()): Promise<GenerationResult> {
  const today = todayLocal(now);
  const nowL = nowLocal(now);
  const horizon = addDays(today, HORIZON_DAYS);

  const plans = await all<PlanRow>(
    db,
    "SELECT id, team_id, kind, valid_from, valid_to FROM training_plans WHERE valid_to >= ? AND valid_from <= ?",
    today,
    horizon,
  );
  const planIds = plans.map((p) => p.id);
  const rules = await all<RuleRow>(
    db,
    "SELECT id, plan_id, weekday, starts_at, ends_at, location_id FROM training_rules WHERE plan_id IN (SELECT value FROM json_each(?))",
    list(planIds),
  );
  const ruleTeamRows = await all<{ rule_id: number; team_id: number }>(
    db,
    "SELECT rule_id, team_id FROM rule_teams WHERE rule_id IN (SELECT value FROM json_each(?))",
    list(rules.map((r) => r.id)),
  );
  const ruleTeams = new Map<number, number[]>();
  for (const rt of ruleTeamRows) ruleTeams.set(rt.rule_id, [...(ruleTeams.get(rt.rule_id) ?? []), rt.team_id]);

  const desired = plannedOccurrences(plans, rules, ruleTeams, today, horizon, nowL);

  const existing = await all<ExistingRow>(
    db,
    `SELECT e.id, e.rule_id, e.rule_date, e.starts_at, e.ends_at, e.location_id, e.is_detached, e.cancelled_at,
            (SELECT group_concat(team_id) FROM (SELECT team_id FROM event_teams WHERE event_id = e.id ORDER BY team_id)) AS team_ids
       FROM events e
      WHERE e.rule_id IS NOT NULL AND e.rule_date >= ? AND e.rule_date <= ? AND e.starts_at > ?`,
    today,
    horizon,
    nowL,
  );

  const statements: D1PreparedStatement[] = [];
  const result: GenerationResult = { created: 0, updated: 0, deleted: 0, changedEventIds: [] };

  for (const ex of existing) {
    const key = `${ex.rule_id}|${ex.rule_date}`;
    const want = desired.get(key);
    if (want) {
      desired.delete(key);
      if (ex.is_detached === 1) continue;
      if (ex.starts_at !== want.startsAt || ex.ends_at !== want.endsAt || ex.location_id !== want.locationId) {
        statements.push(
          stmt(
            db,
            "UPDATE events SET starts_at = ?, ends_at = ?, location_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            want.startsAt,
            want.endsAt,
            want.locationId,
            ex.id,
          ),
        );
        result.updated++;
        result.changedEventIds.push(ex.id);
      }
      if ((ex.team_ids ?? "") !== want.teamIds.join(",")) {
        statements.push(stmt(db, "DELETE FROM event_teams WHERE event_id = ?", ex.id));
        for (const t of want.teamIds) statements.push(stmt(db, "INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)", ex.id, t));
      }
    } else {
      // Manuell verschobene Termine bleiben; abgesagte und reguläre entfallen.
      if (ex.is_detached === 1 && !ex.cancelled_at) continue;
      statements.push(stmt(db, "DELETE FROM events WHERE id = ?", ex.id));
      result.deleted++;
    }
  }

  for (const occ of desired.values()) {
    statements.push(
      stmt(
        db,
        `INSERT OR IGNORE INTO events (kind, starts_at, ends_at, location_id, rule_id, rule_date)
         VALUES ('training', ?, ?, ?, ?, ?)`,
        occ.startsAt,
        occ.endsAt,
        occ.locationId,
        occ.ruleId,
        occ.date,
      ),
    );
    for (const t of occ.teamIds) {
      statements.push(
        stmt(
          db,
          "INSERT OR IGNORE INTO event_teams (event_id, team_id) SELECT id, ? FROM events WHERE rule_id = ? AND rule_date = ?",
          t,
          occ.ruleId,
          occ.date,
        ),
      );
    }
    result.created++;
  }

  statements.push(
    stmt(
      db,
      "INSERT INTO app_meta (key, value) VALUES ('generated_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      today,
    ),
  );
  await batch(db, statements);
  return result;
}

/** Erzeugt Termine, falls das heute noch nicht passiert ist. */
export async function ensureGenerated(db: D1Database, now = Date.now()): Promise<void> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = 'generated_on'");
  if (row?.value === todayLocal(now)) return;
  await generateTrainings(db, now);
}

/** Löscht zukünftige Termine einer Regel (vor dem Löschen der Regel). */
export async function deleteFutureEventsOfRules(db: D1Database, ruleIds: number[], now = Date.now()): Promise<void> {
  if (!ruleIds.length) return;
  await run(
    db,
    "DELETE FROM events WHERE rule_id IN (SELECT value FROM json_each(?)) AND starts_at > ?",
    list(ruleIds),
    nowLocal(now),
  );
}
