import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { type Actor, isCoachOf, requireCoach } from "../auth/actor";
import { deleteFutureEventsOfRules, generateTrainings, HORIZON_DAYS, plannedOccurrences } from "../domain/generate";
import { holidayPeriods } from "../domain/holidays";
import { requireTeam } from "../domain/groups";
import { notifyPersons } from "../domain/notify";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, forbidden, notFound, parse, readJson } from "../lib/http";
import { addDays, isDate, isTime, nowLocal, todayLocal } from "../lib/time";
import { isoWeekdayPlural } from "../../shared/dates";
import { currentLocale } from "../i18n";

export const planRoutes = new Hono<AppEnv>();

const ruleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startsAt: z.string().refine(isTime, { error: () => t`Invalid time` }),
    endsAt: z.string().refine(isTime, { error: () => t`Invalid time` }),
    locationId: z.number().int().positive(),
    teamIds: z.array(z.number().int().positive()).max(10).default([]),
  })
  .refine((r) => r.startsAt < r.endsAt, { error: () => t`The end must be after the start.` });

const planSchema = z
  .object({
    name: z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(80),
    kind: z.enum(["regular", "holiday"]),
    validFrom: z.string().refine(isDate, { error: () => t`Invalid date` }),
    validTo: z.string().refine(isDate, { error: () => t`Invalid date` }),
    declineHours: z.number().int().min(0).max(168).nullable().optional(),
    /** Holiday plans only: linked holiday period whose dates the plan takes over */
    holidayPeriodId: z.number().int().positive().nullable().optional(),
    rules: z.array(ruleSchema).max(20).default([]),
  })
  .refine((p) => p.validFrom <= p.validTo, { error: () => t`The end must be after the start.` });

interface PlanRow {
  id: number;
  team_id: number;
  name: string;
  kind: "regular" | "holiday";
  valid_from: string;
  valid_to: string;
  decline_hours: number | null;
  holiday_period_id: number | null;
}

/** Holiday plan with a period: the dates come from the holiday period. */
async function linkedDates(db: D1Database, kind: "regular" | "holiday", periodId: number | null | undefined) {
  if (kind !== "holiday" || !periodId) return null;
  const period = await first<{ id: number; starts_on: string; ends_on: string }>(db, "SELECT id, starts_on, ends_on FROM holiday_periods WHERE id = ?", periodId);
  if (!period) throw badRequest(t`This holiday period no longer exists.`);
  return { id: period.id, validFrom: period.starts_on, validTo: period.ends_on };
}

interface RuleView {
  id: number;
  plan_id: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location_id: number;
  location_name: string;
  team_ids: string | null;
  team_names: string | null;
}

async function rulesOf(db: D1Database, planIds: number[]): Promise<RuleView[]> {
  return all<RuleView>(
    db,
    `SELECT r.id, r.plan_id, r.weekday, r.starts_at, r.ends_at, r.location_id, l.name AS location_name,
            (SELECT group_concat(t.id) FROM rule_teams rt JOIN teams t ON t.id = rt.team_id WHERE rt.rule_id = r.id) AS team_ids,
            (SELECT group_concat(t.name, ', ') FROM rule_teams rt JOIN teams t ON t.id = rt.team_id WHERE rt.rule_id = r.id) AS team_names
       FROM training_rules r JOIN locations l ON l.id = r.location_id
      WHERE r.plan_id IN (SELECT value FROM json_each(?))
      ORDER BY r.weekday, r.starts_at`,
    list(planIds),
  );
}

function ruleOut(r: RuleView) {
  const ids = (r.team_ids ?? "").split(",").filter(Boolean).map(Number);
  const names = (r.team_names ?? "").split(", ").filter(Boolean);
  return {
    id: r.id,
    weekday: r.weekday,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    location: { id: r.location_id, name: r.location_name },
    teams: ids.map((id, i) => ({ id, name: names[i] ?? "" })),
  };
}

planRoutes.get("/teams/:id/plans", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const db = c.env.DB;
  const plans = await all<PlanRow>(db, "SELECT * FROM training_plans WHERE team_id = ? ORDER BY kind, valid_from", teamId);
  const rules = await rulesOf(db, plans.map((p) => p.id));
  // Shared rules from plans of other teams in which this team takes part
  const shared = await all<RuleView & { plan_name: string; owner_team: string; valid_from: string; valid_to: string }>(
    db,
    `SELECT r.id, r.plan_id, r.weekday, r.starts_at, r.ends_at, r.location_id, l.name AS location_name,
            tp.name AS plan_name, ot.name AS owner_team, tp.valid_from, tp.valid_to,
            (SELECT group_concat(t.id) FROM rule_teams rt2 JOIN teams t ON t.id = rt2.team_id WHERE rt2.rule_id = r.id) AS team_ids,
            (SELECT group_concat(t.name, ', ') FROM rule_teams rt2 JOIN teams t ON t.id = rt2.team_id WHERE rt2.rule_id = r.id) AS team_names
       FROM rule_teams rt JOIN training_rules r ON r.id = rt.rule_id JOIN training_plans tp ON tp.id = r.plan_id
       JOIN teams ot ON ot.id = tp.team_id JOIN locations l ON l.id = r.location_id
      WHERE rt.team_id = ? AND tp.team_id <> ? AND tp.valid_to >= ?
      ORDER BY r.weekday, r.starts_at`,
    teamId,
    teamId,
    todayLocal(),
  );
  const today = todayLocal();
  return c.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      validFrom: p.valid_from,
      validTo: p.valid_to,
      declineHours: p.decline_hours,
      holidayPeriodId: p.holiday_period_id,
      isCurrent: p.valid_from <= today && today <= p.valid_to,
      rules: rules.filter((r) => r.plan_id === p.id).map(ruleOut),
    })),
    sharedRules: shared.map((r) => ({ ...ruleOut(r), planName: r.plan_name, ownerTeam: r.owner_team, validFrom: r.valid_from, validTo: r.valid_to })),
    // All upcoming holiday periods, also after the end of the season (e.g. summer holidays)
    holidays: (await holidayPeriods(db)).filter((h) => h.endsOn >= today),
    allTeams: await all<{ id: number; name: string }>(db, "SELECT id, name FROM teams WHERE kind = 'team' ORDER BY name"),
  });
});

/**
 * Locations must be the club's own, and teams other than the plan's own may only be added or removed by someone
 * who coaches them (`before`: teams of the rule so far), as with events.
 */
async function checkRuleInputs(db: D1Database, actor: Actor, ownTeamId: number, rules: z.infer<typeof ruleSchema>[], before: number[] = []) {
  const locationIds = [...new Set(rules.map((r) => r.locationId))];
  if (locationIds.length) {
    const locs = await all<{ id: number; kind: string }>(db, "SELECT id, kind FROM locations WHERE id IN (SELECT value FROM json_each(?))", list(locationIds));
    if (locs.length !== locationIds.length || locs.some((l) => l.kind === "external")) {
      throw badRequest(t`Please choose a club hall or a saved training location.`);
    }
  }
  const teamIds = [...new Set(rules.flatMap((r) => r.teamIds))];
  if (teamIds.length) {
    const teams = await all<{ id: number }>(db, "SELECT id FROM teams WHERE kind = 'team' AND id IN (SELECT value FROM json_each(?))", list(teamIds));
    if (teams.length !== teamIds.length) throw badRequest(t`Unknown team.`);
  }
  for (const rule of rules) {
    const after = new Set([ownTeamId, ...rule.teamIds]);
    const changed = [...[...after].filter((t) => !before.includes(t) && t !== ownTeamId), ...before.filter((t) => !after.has(t))];
    if (changed.some((t) => !isCoachOf(actor, t))) throw forbidden(t`You can only add or remove other teams if you coach them too.`);
  }
}

/** Creates a rule; rule_teams refers to the rule just inserted (same transaction). */
function ruleStatements(db: D1Database, planId: number, teamId: number, rule: z.infer<typeof ruleSchema>) {
  const teamIds = [...new Set([teamId, ...rule.teamIds])];
  return [
    stmt(
      db,
      "INSERT INTO training_rules (plan_id, weekday, starts_at, ends_at, location_id) VALUES (?, ?, ?, ?, ?)",
      planId,
      rule.weekday,
      rule.startsAt,
      rule.endsAt,
      rule.locationId,
    ),
    ...teamIds.map((t) => stmt(db, "INSERT INTO rule_teams (rule_id, team_id) VALUES ((SELECT max(id) FROM training_rules), ?)", t)),
  ];
}

planRoutes.post("/teams/:id/plans", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const input = parse(planSchema, await readJson(c.req.raw));
  await checkRuleInputs(c.env.DB, actor, teamId, input.rules);
  const linked = await linkedDates(c.env.DB, input.kind, input.holidayPeriodId);
  const plan = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO training_plans (team_id, name, kind, valid_from, valid_to, decline_hours, holiday_period_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    teamId,
    input.name,
    input.kind,
    linked?.validFrom ?? input.validFrom,
    linked?.validTo ?? input.validTo,
    input.declineHours ?? null,
    linked?.id ?? null,
  );
  const statements = input.rules.flatMap((r) => ruleStatements(c.env.DB, plan!.id, teamId, r));
  if (statements.length) await c.env.DB.batch(statements);
  const result = await generateTrainings(c.env.DB);
  return c.json({ id: plan!.id, created: result.created }, 201);
});

async function planForCoach(db: D1Database, actor: Actor, planId: number): Promise<PlanRow> {
  const plan = await first<PlanRow>(db, "SELECT * FROM training_plans WHERE id = ?", planId);
  if (!plan) throw notFound(t`This plan does not exist.`);
  requireCoach(actor, plan.team_id);
  return plan;
}

const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  validFrom: z.string().refine(isDate).optional(),
  validTo: z.string().refine(isDate).optional(),
  declineHours: z.number().int().min(0).max(168).nullable().optional(),
  /** null removes the link to the holiday period */
  holidayPeriodId: z.number().int().positive().nullable().optional(),
});

planRoutes.patch("/plans/:id", async (c) => {
  const actor = requireActor(c);
  const plan = await planForCoach(c.env.DB, actor, intParam(c, "id"));
  const input = parse(planUpdateSchema, await readJson(c.req.raw));
  // New dates by hand remove the link; a new link sets the dates of the period
  const periodId =
    input.holidayPeriodId !== undefined ? input.holidayPeriodId : input.validFrom || input.validTo ? null : plan.holiday_period_id;
  const linked = await linkedDates(c.env.DB, plan.kind, periodId);
  const validFrom = linked?.validFrom ?? input.validFrom ?? plan.valid_from;
  const validTo = linked?.validTo ?? input.validTo ?? plan.valid_to;
  if (validFrom > validTo) throw badRequest(t`The end must be after the start.`);
  await run(
    c.env.DB,
    "UPDATE training_plans SET name = ?, valid_from = ?, valid_to = ?, decline_hours = ?, holiday_period_id = ? WHERE id = ?",
    input.name ?? plan.name,
    validFrom,
    validTo,
    input.declineHours === undefined ? plan.decline_hours : input.declineHours,
    linked?.id ?? null,
    plan.id,
  );
  await generateTrainings(c.env.DB);
  return c.json({ ok: true });
});

planRoutes.delete("/plans/:id", async (c) => {
  const actor = requireActor(c);
  const plan = await planForCoach(c.env.DB, actor, intParam(c, "id"));
  const ruleIds = (await all<{ id: number }>(c.env.DB, "SELECT id FROM training_rules WHERE plan_id = ?", plan.id)).map((r) => r.id);
  await deleteFutureEventsOfRules(c.env.DB, ruleIds);
  await run(c.env.DB, "DELETE FROM training_plans WHERE id = ?", plan.id);
  await generateTrainings(c.env.DB);
  return c.json({ ok: true });
});

planRoutes.post("/plans/:id/rules", async (c) => {
  const actor = requireActor(c);
  const plan = await planForCoach(c.env.DB, actor, intParam(c, "id"));
  const rule = parse(ruleSchema, await readJson(c.req.raw));
  await checkRuleInputs(c.env.DB, actor, plan.team_id, [rule]);
  await c.env.DB.batch(ruleStatements(c.env.DB, plan.id, plan.team_id, rule));
  const result = await generateTrainings(c.env.DB);
  return c.json({ ok: true, created: result.created }, 201);
});

async function ruleForCoach(db: D1Database, actor: Actor, ruleId: number) {
  const rule = await first<{ id: number; plan_id: number; team_id: number; weekday: number; starts_at: string; ends_at: string; location_id: number; plan_kind: string }>(
    db,
    `SELECT r.id, r.plan_id, tp.team_id, r.weekday, r.starts_at, r.ends_at, r.location_id, tp.kind AS plan_kind
       FROM training_rules r JOIN training_plans tp ON tp.id = r.plan_id WHERE r.id = ?`,
    ruleId,
  );
  if (!rule) throw notFound(t`This training time does not exist.`);
  const teams = (await all<{ team_id: number }>(db, "SELECT team_id FROM rule_teams WHERE rule_id = ?", ruleId)).map((r) => r.team_id);
  if (!isCoachOf(actor, rule.team_id) && !teams.some((t) => isCoachOf(actor, t))) {
    throw forbidden(t`Only coaches of the teams involved may do this.`);
  }
  return { rule, teams };
}

planRoutes.patch("/rules/:id", async (c) => {
  const actor = requireActor(c);
  const { rule, teams } = await ruleForCoach(c.env.DB, actor, intParam(c, "id"));
  const input = parse(ruleSchema, await readJson(c.req.raw));
  await checkRuleInputs(c.env.DB, actor, rule.team_id, [input], teams);
  const teamIds = [...new Set([rule.team_id, ...input.teamIds])];
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE training_rules SET weekday = ?, starts_at = ?, ends_at = ?, location_id = ? WHERE id = ?", input.weekday, input.startsAt, input.endsAt, input.locationId, rule.id),
    stmt(c.env.DB, "DELETE FROM rule_teams WHERE rule_id = ?", rule.id),
    ...teamIds.map((t) => stmt(c.env.DB, "INSERT INTO rule_teams (rule_id, team_id) VALUES (?, ?)", rule.id, t)),
  ]);
  await generateTrainings(c.env.DB);
  const changed = input.weekday !== rule.weekday || input.startsAt !== rule.starts_at || input.endsAt !== rule.ends_at || input.locationId !== rule.location_id;
  if (changed) {
    const loc = await first<{ name: string }>(c.env.DB, "SELECT name FROM locations WHERE id = ?", input.locationId);
    const players = await all<{ person_id: number }>(
      c.env.DB,
      `SELECT DISTINCT tm.person_id FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id IN (SELECT value FROM json_each(?)) AND tm.role IN ('player', 'staff') AND p.is_active = 1 AND p.is_former = 0`,
      list([...new Set([...teams, ...teamIds])]),
    );
    const { startsAt, endsAt } = input;
    const location = loc?.name ?? "";
    await notifyPersons(
      c.env,
      players.map((p) => p.person_id),
      "events",
      () => {
        const weekdays = isoWeekdayPlural(currentLocale(), input.weekday);
        return {
          title: t`Training time changed`,
          body: t`Training now ${weekdays} ${startsAt}–${endsAt}, ${location}.`,
          url: "/termine",
        };
      },
      { teamIds: [...new Set([...teams, ...teamIds])], exclude: [actor.accountId] },
    );
  }
  return c.json({ ok: true });
});

planRoutes.delete("/rules/:id", async (c) => {
  const actor = requireActor(c);
  const { rule } = await ruleForCoach(c.env.DB, actor, intParam(c, "id"));
  await deleteFutureEventsOfRules(c.env.DB, [rule.id]);
  await run(c.env.DB, "DELETE FROM training_rules WHERE id = ?", rule.id);
  await generateTrainings(c.env.DB);
  return c.json({ ok: true });
});

const previewSchema = z.object({
  kind: z.enum(["regular", "holiday"]),
  validFrom: z.string().refine(isDate),
  validTo: z.string().refine(isDate),
  planId: z.number().int().positive().optional(),
  rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), startsAt: z.string().refine(isTime), endsAt: z.string().refine(isTime) })).max(20),
});

/** Preview: how many events will be created, and which holidays still have no holiday plan? */
planRoutes.post("/teams/:id/plans/preview", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const input = parse(previewSchema, await readJson(c.req.raw));
  const today = todayLocal();
  const horizon = addDays(today, HORIZON_DAYS);
  const existingPlans = await all<{ id: number; team_id: number; kind: "regular" | "holiday"; valid_from: string; valid_to: string }>(
    c.env.DB,
    "SELECT id, team_id, kind, valid_from, valid_to FROM training_plans WHERE team_id = ? AND id <> ?",
    teamId,
    input.planId ?? 0,
  );
  const draft = { id: -1, team_id: teamId, kind: input.kind, valid_from: input.validFrom, valid_to: input.validTo };
  const rules = input.rules.map((r, i) => ({ id: -(i + 1), plan_id: -1, weekday: r.weekday, starts_at: r.startsAt, ends_at: r.endsAt, location_id: 0 }));
  const occurrences = plannedOccurrences([...existingPlans, draft], rules, new Map(), today, horizon, nowLocal());

  const holidays = await holidayPeriods(c.env.DB, today, horizon);
  const holidayPlans = [...existingPlans, draft].filter((p) => p.kind === "holiday");
  const uncovered =
    input.kind === "regular"
      ? holidays.filter((h) => h.endsOn >= input.validFrom && h.startsOn <= input.validTo && !holidayPlans.some((p) => p.valid_from <= h.startsOn && h.endsOn <= p.valid_to))
      : [];
  return c.json({
    weeks: Math.round(HORIZON_DAYS / 7),
    occurrences: occurrences.size,
    uncoveredHolidays: uncovered.map((h) => ({ name: h.name, startsOn: h.startsOn, endsOn: h.endsOn })),
  });
});
