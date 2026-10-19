import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, intParam, requireActor } from "../app";
import { requireAdmin, requireCoach } from "../auth/actor";
import { syncAutoSquads } from "../domain/auto-squad";
import { closeParentConnections } from "../domain/chat";
import { listExtraEvents } from "../domain/extra-events";
import { requireTeam, syncAutoGroups, teamKind } from "../domain/groups";
import { clubMemberStmt, resetTeamDuties } from "../domain/duties";
import { createInvite, inviteUrl, tokenForNonce } from "../domain/invites";
import { helpCandidates, teamCandidates } from "./squad";
import { notifyCoaches } from "../domain/notify";
import { ageWarning } from "./squad";
import { all, first, list, run, stmt } from "../lib/db";
import { badRequest, conflict, notFound, parse, readJson } from "../lib/http";
import { nowLocal, utcIso } from "../lib/time";
import { relyingParty } from "../auth/webauthn";

export const teamRoutes = new Hono<AppEnv>();

const nameField = z.string().trim().min(1, { error: () => t`Please enter a name.` }).max(50, { error: () => t`The name is too long.` });
const birthYearField = z.number().int().min(1930).max(2100).nullable();

teamRoutes.get("/teams", async (c) => {
  const actor = requireActor(c);
  const rows = await all<{
    id: number;
    name: string;
    kind: "team" | "group";
    auto_members: "referees" | null;
    age_class_code: string;
    gender: "f" | "m" | "x";
    level: number;
    parents_enabled: number;
    players: number;
    coaches: number;
  }>(
    c.env.DB,
    `SELECT t.id, t.name, t.kind, t.auto_members, t.age_class_code, t.gender, t.level, t.parents_enabled,
            (SELECT count(*) FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
              WHERE tm.team_id = t.id AND tm.role = 'player' AND p.is_former = 0) AS players,
            (SELECT count(*) FROM team_memberships tm WHERE tm.team_id = t.id AND tm.role = 'coach') AS coaches
       FROM teams t
      WHERE ?1 = 1 OR t.id IN (SELECT value FROM json_each(?2))
      ORDER BY t.name`,
    actor.isAdmin ? 1 : 0,
    list(actor.coachTeamIds),
  );
  return c.json({
    teams: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      autoMembers: r.auto_members,
      ageClassCode: r.age_class_code,
      gender: r.gender,
      level: r.level,
      parentsEnabled: r.parents_enabled === 1,
      players: r.players,
      coaches: r.coaches,
    })),
  });
});

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(30),
  ageClassCode: z.string().trim().min(1).max(10),
  /** f female, m male, x mixed */
  gender: z.enum(["f", "m", "x"]).default("x"),
  level: z.number().int().min(1).max(9).default(1),
  /** If not given: youth with parents, adults without. */
  parentsEnabled: z.boolean().optional(),
});

teamRoutes.post("/teams", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(createTeamSchema, await readJson(c.req.raw));
  const ageClass = await first<{ is_youth: number }>(
    c.env.DB,
    "SELECT ac.is_youth FROM age_classes ac JOIN seasons s ON s.id = ac.season_id AND s.is_current = 1 WHERE ac.code = ?",
    input.ageClassCode,
  );
  const parentsEnabled = input.parentsEnabled ?? (ageClass ? ageClass.is_youth === 1 : true);
  try {
    const row = await first<{ id: number }>(
      c.env.DB,
      "INSERT INTO teams (name, age_class_code, gender, level, parents_enabled, max_squad) VALUES (?, ?, ?, ?, ?, 20) RETURNING id",
      input.name,
      input.ageClassCode,
      input.gender,
      input.level,
      parentsEnabled ? 1 : 0,
    );
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict(t`A team with this name already exists.`);
    throw err;
  }
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(30),
  /** referees: members follow the KiHaSL/JuHaSL role, admins are in charge. */
  autoMembers: z.enum(["referees"]).nullable().default(null),
});

/** Creates a group: only chat and special events (admins). */
teamRoutes.post("/groups", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(createGroupSchema, await readJson(c.req.raw));
  try {
    const row = await first<{ id: number }>(
      c.env.DB,
      `INSERT INTO teams (name, kind, auto_members, age_class_code, level, parents_enabled, helper_plan, max_squad)
       VALUES (?, 'group', ?, '', 1, 0, 0, 40) RETURNING id`,
      input.name,
      input.autoMembers,
    );
    if (input.autoMembers) await syncAutoGroups(c.env.DB);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict(t`A team or group with this name already exists.`);
    throw err;
  }
});

interface TeamRow {
  id: number;
  name: string;
  gender: "f" | "m" | "x";
  home_template_id: number | null;
  away_template_id: number | null;
  kind: "team" | "group";
  auto_members: "referees" | null;
  age_class_code: string;
  level: number;
  parents_enabled: number;
  decline_hours_training: number;
  decline_hours_game: number;
  max_squad: number;
  auto_squad: number;
  helper_plan: number;
  show_responses: number;
}

teamRoutes.get("/teams/:id", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const db = c.env.DB;
  const team = await first<TeamRow>(db, "SELECT * FROM teams WHERE id = ?", teamId);
  if (!team) throw notFound(t`This team does not exist.`);

  const [members, guardians, core, invites, ac, unexcusedRows] = await Promise.all([
    all<{
      person_id: number;
      role: "player" | "coach" | "helper" | "staff";
      helper_trainings: number;
      first_name: string;
      last_name: string | null;
      birth_year: number | null;
      is_active: number;
      has_account: number;
      has_push: number;
      home_team: string | null;
    }>(
      db,
      `SELECT tm.person_id, tm.role, tm.helper_trainings, p.first_name, p.last_name, p.birth_year, p.is_active,
              EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL) AS has_account,
              EXISTS (SELECT 1 FROM accounts a JOIN push_subscriptions ps ON ps.account_id = a.id WHERE a.person_id = p.id AND a.disabled_at IS NULL) AS has_push,
              (SELECT group_concat(name, ' · ') FROM (SELECT t2.name FROM team_memberships m2 JOIN teams t2 ON t2.id = m2.team_id
                WHERE m2.person_id = p.id AND m2.role = 'player' AND m2.team_id <> tm.team_id AND t2.kind = 'team' ORDER BY t2.name)) AS home_team
         FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
        WHERE tm.team_id = ? AND p.is_former = 0
        ORDER BY p.first_name, p.last_name, p.id`,
      teamId,
    ),
    all<{ child_id: number; guardian_id: number; first_name: string; last_name: string | null; has_account: number; has_push: number }>(
      db,
      `SELECT g.child_id, g.guardian_id, p.first_name, p.last_name,
              EXISTS (SELECT 1 FROM accounts a WHERE a.person_id = p.id AND a.disabled_at IS NULL) AS has_account,
              EXISTS (SELECT 1 FROM accounts a JOIN push_subscriptions ps ON ps.account_id = a.id WHERE a.person_id = p.id AND a.disabled_at IS NULL) AS has_push
         FROM guardianships g JOIN persons p ON p.id = g.guardian_id
        WHERE g.child_id IN (SELECT person_id FROM team_memberships WHERE team_id = ? AND role IN ('player', 'helper'))
          AND p.is_former = 0 AND ? = 1
        ORDER BY p.first_name`,
      teamId,
      team.parents_enabled,
    ),
    all<{ person_id: number }>(db, "SELECT person_id FROM core_squad WHERE team_id = ?", teamId),
    all<{ id: number; kind: "player" | "parent"; nonce: string; expires_at: string; created_at: string }>(
      db,
      `SELECT id, kind, nonce, expires_at, created_at FROM invites
        WHERE team_id = ? AND kind IN ('player', 'parent') AND revoked_at IS NULL AND expires_at > ?`,
      teamId,
      utcIso(),
    ),
    first<{ name: string; birth_year_min: number | null; birth_year_max: number | null }>(
      db,
      `SELECT ac.name, ac.birth_year_min, ac.birth_year_max FROM age_classes ac
         JOIN seasons s ON s.id = ac.season_id AND s.is_current = 1 WHERE ac.code = ?`,
      team.age_class_code,
    ),
    // Unexcused absences at this team's events; events exist only from the current season
    all<{ person_id: number; n: number }>(
      db,
      `SELECT am.person_id, count(*) AS n FROM attendance_marks am
         JOIN event_teams et ON et.event_id = am.event_id AND et.team_id = ?
        WHERE am.status = 'unexcused'
        GROUP BY am.person_id`,
      teamId,
    ),
  ]);

  const origin = relyingParty(c.env, c.req.raw).origin;
  const inviteView = async (kind: "player" | "parent") => {
    if (kind === "parent" && team.parents_enabled !== 1) return null;
    const inv = invites.filter((i) => i.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!inv) return null;
    return { id: inv.id, url: inviteUrl(origin, await tokenForNonce(c.env, inv.nonce)), expiresAt: inv.expires_at };
  };

  const coreIds = new Set(core.map((r) => r.person_id));
  const unexcused = new Map(unexcusedRows.map((r) => [r.person_id, r.n]));
  const players = members.filter((m) => m.role === "player");
  const nameCount = new Map<string, { label: string; n: number }>();
  for (const p of players) {
    const label = `${p.first_name} ${p.last_name ?? ""}`.trim();
    const entry = nameCount.get(label.toLowerCase()) ?? { label, n: 0 };
    entry.n++;
    nameCount.set(label.toLowerCase(), entry);
  }

  return c.json({
    id: team.id,
    name: team.name,
    kind: team.kind,
    autoMembers: team.auto_members,
    ageClassCode: team.age_class_code,
    ageClassName: ac?.name ?? team.age_class_code,
    level: team.level,
    parentsEnabled: team.parents_enabled === 1,
    declineHoursTraining: team.decline_hours_training,
    declineHoursGame: team.decline_hours_game,
    maxSquad: team.max_squad,
    autoSquad: team.auto_squad === 1,
    helperPlan: team.helper_plan === 1,
    showResponses: team.show_responses === 1,
    homeTemplateId: team.home_template_id,
    awayTemplateId: team.away_template_id,
    coaches: members
      .filter((m) => m.role === "coach")
      .map((m) => ({ person: { id: m.person_id, firstName: m.first_name, lastName: m.last_name }, hasAccount: m.has_account === 1 })),
    staff: members
      .filter((m) => m.role === "staff")
      .map((m) => ({ person: { id: m.person_id, firstName: m.first_name, lastName: m.last_name }, hasAccount: m.has_account === 1, hasPush: m.has_push === 1 })),
    players: players.map((m) => ({
      person: { id: m.person_id, firstName: m.first_name, lastName: m.last_name },
      birthYear: m.birth_year,
      isActive: m.is_active === 1,
      hasAccount: m.has_account === 1,
      hasPush: m.has_push === 1,
      isCore: coreIds.has(m.person_id),
      unexcused: unexcused.get(m.person_id) ?? 0,
      ageWarning: ageWarning(m.birth_year, ac),
      guardians: guardians
        .filter((g) => g.child_id === m.person_id)
        .map((g) => ({ id: g.guardian_id, firstName: g.first_name, lastName: g.last_name, hasAccount: g.has_account === 1, hasPush: g.has_push === 1 })),
    })),
    helpers: members
      .filter((m) => m.role === "helper")
      .map((m) => ({
        person: { id: m.person_id, firstName: m.first_name, lastName: m.last_name },
        homeTeam: m.home_team,
        trainings: m.helper_trainings === 1,
        isActive: m.is_active === 1,
        isCore: coreIds.has(m.person_id),
        unexcused: unexcused.get(m.person_id) ?? 0,
      })),
    invites: { player: await inviteView("player"), parent: await inviteView("parent") },
    duplicateNames: [...nameCount.values()].filter((e) => e.n > 1).map((e) => e.label),
    missingLastNames: players.filter((p) => !p.last_name).length,
    missingBirthYears: players.filter((p) => p.birth_year == null).length,
  });
});

const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  ageClassCode: z.string().trim().min(1).max(10).optional(),
  gender: z.enum(["f", "m", "x"]).optional(),
  level: z.number().int().min(1).max(9).optional(),
  declineHoursTraining: z.number().int().min(0).max(168).optional(),
  declineHoursGame: z.number().int().min(0).max(168).optional(),
  maxSquad: z.number().int().min(1).max(40).optional(),
  autoSquad: z.boolean().optional(),
  parentsEnabled: z.boolean().optional(),
  /** Helper plan for this team (coaches and admins). */
  helperPlan: z.boolean().optional(),
  /** Responses (without reasons) visible to players and parents (coaches and admins). */
  showResponses: z.boolean().optional(),
  /** Helper duty template for home or away games, null = default (coaches and admins). */
  homeTemplateId: z.number().int().positive().nullable().optional(),
  awayTemplateId: z.number().int().positive().nullable().optional(),
});

teamRoutes.patch("/teams/:id", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const input = parse(updateTeamSchema, await readJson(c.req.raw));
  if ((input.name || input.ageClassCode || input.gender || input.level || input.parentsEnabled !== undefined) && !actor.isAdmin) requireAdmin(actor);
  const team = await first<TeamRow>(c.env.DB, "SELECT * FROM teams WHERE id = ?", teamId);
  if (!team) throw notFound();
  if (team.kind === "group" && (input.ageClassCode || input.level || input.parentsEnabled || input.helperPlan || input.autoSquad || input.homeTemplateId || input.awayTemplateId)) {
    throw badRequest(t`Groups only have chat and special events.`, "group_not_supported");
  }
  for (const tid of [input.homeTemplateId, input.awayTemplateId]) {
    if (tid != null && !(await first(c.env.DB, "SELECT 1 AS ok FROM duty_templates WHERE id = ?", tid))) throw badRequest(t`This template does not exist.`);
  }
  try {
    await run(
      c.env.DB,
      `UPDATE teams SET name = ?, age_class_code = ?, gender = ?, level = ?, decline_hours_training = ?, decline_hours_game = ?, max_squad = ?,
         auto_squad = ?, parents_enabled = ?, helper_plan = ?, show_responses = ?, home_template_id = ?, away_template_id = ? WHERE id = ?`,
      input.name ?? team.name,
      input.ageClassCode ?? team.age_class_code,
      input.gender ?? team.gender,
      input.level ?? team.level,
      input.declineHoursTraining ?? team.decline_hours_training,
      input.declineHoursGame ?? team.decline_hours_game,
      input.maxSquad ?? team.max_squad,
      input.autoSquad === undefined ? team.auto_squad : input.autoSquad ? 1 : 0,
      input.parentsEnabled === undefined ? team.parents_enabled : input.parentsEnabled ? 1 : 0,
      input.helperPlan === undefined ? team.helper_plan : input.helperPlan ? 1 : 0,
      input.showResponses === undefined ? team.show_responses : input.showResponses ? 1 : 0,
      input.homeTemplateId === undefined ? team.home_template_id : input.homeTemplateId,
      input.awayTemplateId === undefined ? team.away_template_id : input.awayTemplateId,
      teamId,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw conflict(t`A team with this name already exists.`);
    throw err;
  }
  if (input.parentsEnabled === false && team.parents_enabled === 1) {
    // From now on without parents: parent links invalid, disconnect open parent connections in the chat
    await run(c.env.DB, "UPDATE invites SET revoked_at = ? WHERE kind = 'parent' AND team_id = ? AND revoked_at IS NULL", utcIso(), teamId);
    c.executionCtx.waitUntil(closeParentConnections(c.env, teamId));
  }
  if (input.autoSquad) await syncAutoSquads(c.env.DB, [teamId]);
  // New template: upcoming games without entries get their duties anew
  if (
    (input.homeTemplateId !== undefined && input.homeTemplateId !== team.home_template_id) ||
    (input.awayTemplateId !== undefined && input.awayTemplateId !== team.away_template_id)
  ) {
    await resetTeamDuties(c.env.DB, teamId, nowLocal());
  }
  return c.json({ ok: true });
});

teamRoutes.delete("/teams/:id", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const teamId = intParam(c, "id");
  // Groups can be deleted with their assignments; the persons remain
  const { kind } = await teamKind(c.env.DB, teamId);
  const members = await first<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM team_memberships WHERE team_id = ?", teamId);
  if (kind === "team" && (members?.n ?? 0) > 0) throw conflict(t`The team still has members. Please remove all of them first.`);
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      `DELETE FROM events WHERE id IN (SELECT event_id FROM event_teams WHERE team_id = ?)
         AND NOT EXISTS (SELECT 1 FROM event_teams o WHERE o.event_id = events.id AND o.team_id <> ?)`,
      teamId,
      teamId,
    ),
    stmt(c.env.DB, "DELETE FROM teams WHERE id = ?", teamId),
  ]);
  return c.json({ ok: true });
});

// Squad -----------------------------------------------------------------------

const newPlayerSchema = z.object({
  firstName: nameField,
  lastName: nameField.nullable().optional(),
  birthYear: birthYearField.optional(),
});

teamRoutes.post("/teams/:id/players", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const input = parse(newPlayerSchema, await readJson(c.req.raw));
  const person = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO persons (first_name, last_name, birth_year) VALUES (?, ?, ?) RETURNING id",
    input.firstName,
    input.lastName ?? null,
    input.birthYear ?? null,
  );
  await run(c.env.DB, "INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'player')", person!.id, teamId);
  await clubMemberStmt(c.env.DB, [person!.id], teamId).run();
  return c.json({ id: person!.id }, 201);
});

const staffSchema = z.object({ firstName: nameField, lastName: nameField.nullable().optional() });

/**
 * Coaches add team staff (physio, manager): a new person who sees everything of the team and gets
 * its changes, but does not take part. Access via a personal link from the squad overview.
 */
teamRoutes.post("/teams/:id/staff", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const input = parse(staffSchema, await readJson(c.req.raw));
  const person = await first<{ id: number }>(
    c.env.DB,
    "INSERT INTO persons (first_name, last_name) VALUES (?, ?) RETURNING id",
    input.firstName,
    input.lastName ?? null,
  );
  await run(c.env.DB, "INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'staff')", person!.id, teamId);
  return c.json({ id: person!.id }, 201);
});

const importSchema = z.object({
  players: z.array(newPlayerSchema).min(1).max(80),
  /** false: only the preview, nothing is created */
  commit: z.boolean().default(false),
});

/**
 * Player list of a coach (from a spreadsheet): new players are created. Names already in the team
 * are skipped; players of a team the coach may take players from are pointed out (taken in via
 * "existing player", so their history stays), nothing else is revealed about other persons.
 */
teamRoutes.post("/teams/:id/players/import", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const { players, commit } = parse(importSchema, await readJson(c.req.raw));
  const key = (first: string, last: string | null | undefined) => `${first.trim().toLowerCase()}|${(last ?? "").trim().toLowerCase()}`;
  const own = new Set(
    (
      await all<{ first_name: string; last_name: string | null }>(
        c.env.DB,
        `SELECT p.first_name, p.last_name FROM team_memberships tm JOIN persons p ON p.id = tm.person_id
          WHERE tm.team_id = ? AND tm.role = 'player' AND p.is_former = 0`,
        teamId,
      )
    ).map((r) => key(r.first_name, r.last_name)),
  );
  const elsewhere = new Map<string, string>();
  for (const r of await teamCandidates(c.env.DB, teamId, "player")) {
    const k = key(r.first_name, r.last_name);
    elsewhere.set(k, elsewhere.has(k) ? `${elsewhere.get(k)}, ${r.team_name}` : r.team_name);
  }
  const seen = new Set<string>();
  const rows = players.map((p) => {
    const k = key(p.firstName, p.lastName);
    const status = own.has(k) || seen.has(k) ? ("in_team" as const) : elsewhere.has(k) ? ("other_team" as const) : ("new" as const);
    seen.add(k);
    return { firstName: p.firstName, lastName: p.lastName ?? null, birthYear: p.birthYear ?? null, status, teams: elsewhere.get(k) ?? null };
  });
  let created = 0;
  if (commit) {
    for (const r of rows.filter((x) => x.status === "new")) {
      const person = await first<{ id: number }>(
        c.env.DB,
        "INSERT INTO persons (first_name, last_name, birth_year) VALUES (?, ?, ?) RETURNING id",
        r.firstName,
        r.lastName,
        r.birthYear,
      );
      await c.env.DB.batch([
        stmt(c.env.DB, "INSERT INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'player')", person!.id, teamId),
        clubMemberStmt(c.env.DB, [person!.id], teamId),
      ]);
      created++;
    }
    if (created) await syncAutoSquads(c.env.DB, [teamId]);
  }
  return c.json({ rows, created });
});

const memberSchema = z.object({ personId: z.number().int().positive(), role: z.enum(["player", "coach", "staff"]) });

/** Admins assign existing persons as players, coaches or staff. */
teamRoutes.post("/teams/:id/members", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const teamId = intParam(c, "id");
  const input = parse(memberSchema, await readJson(c.req.raw));
  if (input.role === "staff") await requireTeam(c.env.DB, teamId);
  if ((await teamKind(c.env.DB, teamId)).autoMembers) throw badRequest(t`The members of this group are determined automatically.`, "auto_members");
  const person = await first(c.env.DB, "SELECT 1 AS ok FROM persons WHERE id = ? AND is_former = 0", input.personId);
  if (!person) throw notFound(t`This person does not exist.`);
  await run(
    c.env.DB,
    "INSERT OR IGNORE INTO team_memberships (person_id, team_id, role) VALUES (?, ?, ?)",
    input.personId,
    teamId,
    input.role,
  );
  await clubMemberStmt(c.env.DB, [input.personId], teamId).run();
  return c.json({ ok: true }, 201);
});

teamRoutes.delete("/teams/:id/members/:personId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  const personId = intParam(c, "personId");
  const { role } = parse(z.object({ role: z.enum(["player", "coach", "helper", "staff"]).default("player") }), { role: c.req.query("role") });
  if (role === "coach") requireAdmin(actor);
  else requireCoach(actor, teamId);
  if ((await teamKind(c.env.DB, teamId)).autoMembers) throw badRequest(t`The members of this group are determined automatically.`, "auto_members");
  const res = await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM team_memberships WHERE team_id = ? AND person_id = ? AND role = ?", teamId, personId, role),
    stmt(
      c.env.DB,
      `DELETE FROM core_squad WHERE team_id = ? AND person_id = ?
         AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id = ? AND person_id = ? AND role IN ('player', 'helper'))`,
      teamId,
      personId,
      teamId,
      personId,
    ),
  ]);
  if (!res[0]!.meta.changes) throw notFound(t`This assignment does not exist.`);
  await syncAutoSquads(c.env.DB, [teamId]);
  return c.json({ ok: true });
});

const coreSchema = z.object({ personIds: z.array(z.number().int().positive()).max(40) });

teamRoutes.put("/teams/:id/core-squad", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const { personIds } = parse(coreSchema, await readJson(c.req.raw));
  const valid = await all<{ person_id: number }>(
    c.env.DB,
    `SELECT person_id FROM team_memberships WHERE team_id = ? AND role IN ('player', 'helper')
       AND person_id IN (SELECT value FROM json_each(?))`,
    teamId,
    list(personIds),
  );
  if (valid.length !== new Set(personIds).size) throw badRequest(t`The core squad may only contain players of this team.`);
  await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM core_squad WHERE team_id = ?", teamId),
    ...[...new Set(personIds)].map((id) => stmt(c.env.DB, "INSERT INTO core_squad (team_id, person_id) VALUES (?, ?)", teamId, id)),
  ]);
  await syncAutoSquads(c.env.DB, [teamId]);
  return c.json({ ok: true });
});

// Permanent stand-ins -------------------------------------------------------------

teamRoutes.get("/teams/:id/helper-candidates", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const rows = await helpCandidates(c.env.DB, teamId);
  return c.json({
    candidates: rows.map((r) => ({
      person: { id: r.person_id, firstName: r.first_name, lastName: r.last_name },
      team: { id: r.team_ids[0]!, name: r.team_name },
      teams: r.teams,
      isActive: r.is_active === 1,
    })),
  });
});

// Additionally take in players from another team (e.g. wC2 → also wC1) ---------------

teamRoutes.get("/teams/:id/player-candidates", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const rows = await teamCandidates(c.env.DB, teamId, "player");
  return c.json({
    candidates: rows.map((r) => ({
      person: { id: r.person_id, firstName: r.first_name, lastName: r.last_name },
      teams: r.teams,
      isActive: r.is_active === 1,
    })),
  });
});

teamRoutes.post("/teams/:id/players/existing", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const { personId } = parse(z.object({ personId: z.number().int().positive() }), await readJson(c.req.raw));
  const candidate = (await teamCandidates(c.env.DB, teamId, "player")).find((r) => r.person_id === personId);
  if (!candidate) throw badRequest(t`Players of other teams of the same or the next younger age class can be taken in.`);
  const team = await first<{ name: string }>(c.env.DB, "SELECT name FROM teams WHERE id = ?", teamId);
  await c.env.DB.batch([
    // A permanent stand-in of this team becomes a player
    stmt(c.env.DB, "DELETE FROM team_memberships WHERE team_id = ? AND person_id = ? AND role = 'helper'", teamId, personId),
    stmt(c.env.DB, "INSERT OR IGNORE INTO team_memberships (person_id, team_id, role) VALUES (?, ?, 'player')", personId, teamId),
    clubMemberStmt(c.env.DB, [personId], teamId),
  ]);
  await syncAutoSquads(c.env.DB, [teamId]);
  const playerName = candidate.first_name;
  const teamName = team?.name;
  const by = actor.firstName;
  c.executionCtx.waitUntil(
    notifyCoaches(
      c.env,
      candidate.team_ids,
      () => ({
        title: t`Squad`,
        body: teamName
          ? t`${playerName} now also plays in the ${teamName} (added by ${by}).`
          : t`${playerName} now also plays in the other team (added by ${by}).`,
        url: `/team/${teamId}`,
      }),
      { exclude: [actor.accountId] },
    ),
  );
  return c.json({ ok: true }, 201);
});

const helperSchema = z.object({ personId: z.number().int().positive(), trainings: z.boolean().default(false) });

teamRoutes.post("/teams/:id/helpers", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const input = parse(helperSchema, await readJson(c.req.raw));
  const ok = (await helpCandidates(c.env.DB, teamId)).some((r) => r.person_id === input.personId);
  if (!ok) throw badRequest(t`Stand-ins come from a lower-ranked team of the same age class or the next younger youth team.`);
  await run(
    c.env.DB,
    `INSERT INTO team_memberships (person_id, team_id, role, helper_trainings) VALUES (?, ?, 'helper', ?)
     ON CONFLICT(person_id, team_id, role) DO UPDATE SET helper_trainings = excluded.helper_trainings`,
    input.personId,
    teamId,
    input.trainings ? 1 : 0,
  );
  return c.json({ ok: true }, 201);
});

teamRoutes.patch("/teams/:id/helpers/:personId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  const { trainings } = parse(z.object({ trainings: z.boolean() }), await readJson(c.req.raw));
  const res = await run(
    c.env.DB,
    "UPDATE team_memberships SET helper_trainings = ? WHERE team_id = ? AND person_id = ? AND role = 'helper'",
    trainings ? 1 : 0,
    teamId,
    intParam(c, "personId"),
  );
  if (!res.meta.changes) throw notFound();
  return c.json({ ok: true });
});

// Invitation links ----------------------------------------------------------------

teamRoutes.post("/teams/:id/invites", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  await requireTeam(c.env.DB, teamId);
  const { kind } = parse(z.object({ kind: z.enum(["player", "parent"]) }), await readJson(c.req.raw));
  if (kind === "parent") {
    const team = await first<{ parents_enabled: number }>(c.env.DB, "SELECT parents_enabled FROM teams WHERE id = ?", teamId);
    if (team?.parents_enabled !== 1) throw conflict(t`Parents are not involved in this team. An admin can change that.`);
  }
  const invite = await createInvite(c.env, { kind, teamId, createdBy: actor.personId });
  return c.json(
    { id: invite.id, url: inviteUrl(relyingParty(c.env, c.req.raw).origin, invite.token), expiresAt: invite.expiresAt },
    201,
  );
});

teamRoutes.delete("/invites/:id", async (c) => {
  const actor = requireActor(c);
  const invite = await first<{ id: number; team_id: number | null; person_id: number | null }>(
    c.env.DB,
    "SELECT id, team_id, person_id FROM invites WHERE id = ?",
    intParam(c, "id"),
  );
  if (!invite) throw notFound();
  if (invite.team_id != null) requireCoach(actor, invite.team_id);
  else requireAdmin(actor);
  await run(c.env.DB, "UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", utcIso(), invite.id);
  return c.json({ ok: true });
});

export { nameField, birthYearField };

/** Team → events: this team's upcoming special events and games without handball4all. */
teamRoutes.get("/teams/:id/extra-events", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "id");
  requireCoach(actor, teamId);
  return c.json({ events: await listExtraEvents(c.env.DB, actor, { teamId }) });
});
