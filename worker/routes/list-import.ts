// The result of the list import in the setup wizard (shared/list-import.ts): teams, players, coaches and staff in one
// step, after the admin checked them in the browser. The lists themselves never reach the server. Running it twice
// creates nothing twice: teams are found by name, persons by name and birth year.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { syncAutoSquads } from "../domain/auto-squad";
import { clubMemberStmt } from "../domain/duties";
import { all, batch, stmt } from "../lib/db";
import { badRequest, parse, readJson } from "../lib/http";
import { nameKey } from "../../shared/list-import";

export const listImportRoutes = new Hono<AppEnv>();

const commitSchema = z.object({
  teams: z
    .array(z.object({ name: z.string().trim().min(1).max(30), ageClassCode: z.string().min(1).max(20), gender: z.enum(["f", "m", "x"]) }))
    .max(200),
  persons: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(50),
        lastName: z.string().trim().max(50),
        birthYear: z.number().int().min(1930).max(2100).nullable(),
        memberships: z.array(z.object({ team: z.string().trim().min(1).max(30), role: z.enum(["player", "coach", "staff"]) })).max(20),
      }),
    )
    .max(3000),
});

const teamKey = (name: string) => name.trim().toLowerCase();

listImportRoutes.post("/admin/import/commit", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(commitSchema, await readJson(c.req.raw));
  const db = c.env.DB;

  // Teams: existing ones by name, the others created with the defaults of POST /teams
  const existing = await all<{ id: number; name: string; kind: "team" | "group" }>(db, "SELECT id, name, kind FROM teams");
  const teamIds = new Map(existing.map((r) => [teamKey(r.name), r]));
  const named = new Set(input.persons.flatMap((p) => p.memberships.map((m) => teamKey(m.team))));
  const wanted = input.teams.filter((tm) => named.has(teamKey(tm.name)));
  for (const tm of wanted) {
    if (teamIds.get(teamKey(tm.name))?.kind === "group") {
      const name = tm.name;
      throw badRequest(t`"${name}" is a group, not a team. Please rename the team in the list.`, "group_name");
    }
  }
  const toCreate = wanted.filter((tm) => !teamIds.has(teamKey(tm.name)));
  const youth = new Map(
    (await all<{ code: string; is_youth: number }>(db, "SELECT ac.code, ac.is_youth FROM age_classes ac JOIN seasons s ON s.id = ac.season_id AND s.is_current = 1")).map(
      (r) => [r.code, r.is_youth === 1],
    ),
  );
  for (const tm of toCreate) {
    if (!youth.has(tm.ageClassCode)) {
      const name = tm.name;
      throw badRequest(t`Please choose an age class for "${name}".`, "age_class");
    }
  }
  const created = await batch(
    db,
    toCreate.map((tm) =>
      stmt(
        db,
        "INSERT INTO teams (name, age_class_code, gender, level, parents_enabled, max_squad) VALUES (?, ?, ?, 1, ?, 20) RETURNING id",
        tm.name,
        tm.ageClassCode,
        tm.gender,
        youth.get(tm.ageClassCode) ? 1 : 0,
      ),
    ),
  );
  toCreate.forEach((tm, i) => teamIds.set(teamKey(tm.name), { id: (created[i]!.results[0] as { id: number }).id, name: tm.name, kind: "team" }));
  for (const p of input.persons) {
    for (const m of p.memberships) {
      if (!teamIds.has(teamKey(m.team))) {
        const name = m.team;
        throw badRequest(t`The team "${name}" is missing in the import.`, "team_missing");
      }
    }
  }

  // Persons: the same name (umlauts and case aside) and a matching or missing birth year is the same person.
  // Read once in full: this runs in the setup of a new club, with few persons yet.
  const known = await all<{ id: number; first_name: string; last_name: string | null; birth_year: number | null }>(
    db,
    "SELECT id, first_name, last_name, birth_year FROM persons WHERE is_former = 0",
  );
  const byName = new Map<string, typeof known>();
  for (const r of known) {
    const k = `${nameKey(r.first_name)}|${nameKey(r.last_name ?? "")}`;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const ids: number[] = new Array(input.persons.length);
  const fresh: number[] = [];
  const yearUpdates = [];
  for (const [i, p] of input.persons.entries()) {
    const match = byName
      .get(`${nameKey(p.firstName)}|${nameKey(p.lastName)}`)
      ?.find((r) => r.birth_year == null || p.birthYear == null || r.birth_year === p.birthYear);
    if (match) {
      ids[i] = match.id;
      if (match.birth_year == null && p.birthYear != null) yearUpdates.push(stmt(db, "UPDATE persons SET birth_year = ? WHERE id = ?", p.birthYear, match.id));
    } else fresh.push(i);
  }
  const inserted = await batch(
    db,
    fresh.map((i) => {
      const p = input.persons[i]!;
      return stmt(db, "INSERT INTO persons (first_name, last_name, birth_year) VALUES (?, ?, ?) RETURNING id", p.firstName, p.lastName || null, p.birthYear);
    }),
  );
  fresh.forEach((i, n) => (ids[i] = (inserted[n]!.results[0] as { id: number }).id));

  // Memberships; members of a team become club members, as with a single assignment
  const memberships = input.persons.flatMap((p, i) => p.memberships.map((m) => ({ personId: ids[i]!, teamId: teamIds.get(teamKey(m.team))!.id, role: m.role })));
  const touched = [...new Set(memberships.map((m) => m.teamId))];
  const res = await batch(db, [
    ...yearUpdates,
    ...memberships.map((m) => stmt(db, "INSERT OR IGNORE INTO team_memberships (person_id, team_id, role) VALUES (?, ?, ?)", m.personId, m.teamId, m.role)),
    ...touched.map((teamId) =>
      clubMemberStmt(
        db,
        memberships.filter((m) => m.teamId === teamId).map((m) => m.personId),
        teamId,
      ),
    ),
  ]);
  const added = res.slice(yearUpdates.length, yearUpdates.length + memberships.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  if (touched.length) await syncAutoSquads(db, touched);
  return c.json({ teamsCreated: toCreate.length, personsCreated: fresh.length, personsFound: input.persons.length - fresh.length, membershipsAdded: added });
});
