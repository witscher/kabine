// Polls module: the tables' upgrade test, season change, leaving the club, export, switched off. Names invented.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { api, exec, freshDb, loginAs, member, migrateRest, person, rows, season, team, upgradeFrom } from "../../../test/helpers";
import { saveClub } from "../../../worker/domain/club";
import { batch } from "../../../worker/lib/db";
import { addDays, nowLocal, todayLocal } from "../../../worker/lib/time";
import { modulePersonLeaves, moduleSeasonChange } from "../../../worker/modules";
import { EXPORT_EXCLUDED, EXPORT_TABLES } from "../../../worker/routes/season";

const later = () => `${addDays(todayLocal(), 7)}T20:00`;
const on = () => saveClub(env.DB, { modules: { ...DEFAULT_MODULES, polls: true } });

describe("Umfragen: Migration", () => {
  it("Upgrade: die Tabellen kommen dazu, bestehende Daten bleiben", async () => {
    await upgradeFrom("202611200110_polls_tables.sql");
    const nora = await person("Nora");
    await migrateRest();
    expect(await rows("SELECT first_name FROM persons WHERE id = ?", nora)).toEqual([{ first_name: "Nora" }]);
    await exec("INSERT INTO polls (kind, title, ends_at) VALUES ('choice', 'Test', '2030-01-01T20:00')");
    await expect(exec("INSERT INTO polls (kind, title, ends_at, anonymous) VALUES ('order', 'Anonym', '2030-01-01T20:00', 1)")).rejects.toThrow();
    expect(await rows("SELECT title FROM polls")).toEqual([{ title: "Test" }]);
  });
});

describe("Umfragen: Lebenszyklus", () => {
  let wd: number;
  let coachCookie: string;
  let lina: number;

  beforeEach(async () => {
    await freshDb();
    await season();
    await on();
    wd = await team("wD", "wD");
    const coach = await person("Tara");
    lina = await person("Lina");
    await member(coach, wd, "coach");
    await member(lina, wd);
    coachCookie = await loginAs(coach);
  });

  const create = async () =>
    (await api("/polls", { cookie: coachCookie, body: { teamId: wd, kind: "choice", title: "Wohin?", whoPlayers: true, endsAt: later(), options: [{ label: "A" }, { label: "B" }] } })).body.id as number;

  it("nicht im Export, aber bewusst ausgenommen", () => {
    for (const table of ["polls", "poll_options", "poll_voters", "poll_ballots", "poll_answers", "poll_option_images", "poll_ignores"]) {
      expect(EXPORT_EXCLUDED, table).toContain(table);
      expect(EXPORT_TABLES, table).not.toContain(table);
    }
  });

  it("der Saisonwechsel löscht alle Umfragen samt Stimmen", async () => {
    const id = await create();
    const opt = (await api(`/polls/${id}`, { cookie: coachCookie })).body.options[0].id;
    await api(`/polls/${id}/ballot`, { method: "PUT", cookie: await loginAs(lina), body: { unitId: lina, answers: [{ optionId: opt, value: 1 }] } });
    await batch(env.DB, moduleSeasonChange(env.DB));
    for (const table of ["polls", "poll_options", "poll_voters", "poll_ballots", "poll_answers"]) expect(await rows(`SELECT 1 FROM ${table}`), table).toEqual([]);
  });

  it("wer den Verein verlässt, stimmt in laufenden Umfragen nicht mehr ab", async () => {
    const id = await create();
    await batch(env.DB, modulePersonLeaves(env.DB, lina, nowLocal()));
    expect(await rows("SELECT 1 FROM poll_voters WHERE person_id = ?", lina)).toEqual([]);
  });

  it("ausgeschaltet: keine Karte, keine Zahl am App-Symbol, die Daten bleiben", async () => {
    const id = await create();
    const linaCookie = await loginAs(lina);
    expect((await api("/badge", { cookie: linaCookie })).body.modules).toBe(1);
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, polls: false } });
    expect((await api("/polls/open", { cookie: linaCookie })).status).toBe(404);
    expect((await api("/badge", { cookie: linaCookie })).body.modules).toBe(0);
    expect(await rows("SELECT id FROM polls")).toEqual([{ id }]);
  });
});
