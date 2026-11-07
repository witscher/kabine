// What is new for admins and coaches: release notes after an update, for admins also the modules they were not told about. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type ChangelogEntry, entriesSince, KABINE_VERSION } from "../shared/changelog";
import { MODULES } from "../shared/modules";
import { saveClub } from "../worker/domain/club";
import { newsEntries } from "../worker/domain/news";
import { api, exec, freshDb, loginAs, member, migrateRest, one, person, season, team, upgradeFrom } from "./helpers";

const allIds = () => JSON.stringify(MODULES.map((m) => m.id));
const withoutIds = (...ids: string[]) => JSON.stringify(MODULES.map((m) => m.id).filter((id) => !ids.includes(id)));
const session = async (cookie: string) => (await api("/session", { cookie })).body.me;

let admin: number;
let adminCookie: string;

beforeEach(async () => {
  await freshDb();
  await season();
  admin = await person("Alma", { admin: true });
  adminCookie = await loginAs(admin);
});

describe("news for admins", () => {
  it("a new admin starts with everything seen", async () => {
    expect((await session(adminCookie)).news).toBeNull();
    expect(await one("SELECT changelog_seen, modules_seen FROM accounts WHERE person_id = ?", admin)).toEqual({ changelog_seen: KABINE_VERSION, modules_seen: allIds() });
  });

  it("shows release notes of newer versions until marked as read, and again after the next update", async () => {
    await session(adminCookie);
    await exec("UPDATE accounts SET changelog_seen = '0.0.1' WHERE person_id = ?", admin);
    const news = (await session(adminCookie)).news;
    expect(news.version).toBe(KABINE_VERSION);
    expect(news.entries[0]).toMatchObject({ version: KABINE_VERSION });
    expect(news.entries[0].items.length).toBeGreaterThan(0);
    expect(news.newModules).toEqual([]);

    expect((await api("/me/news-seen", { cookie: adminCookie, body: {} })).status).toBe(200);
    expect((await session(adminCookie)).news).toBeNull();

    // The next update: the version seen is older again
    await exec("UPDATE accounts SET changelog_seen = '0.0.9' WHERE person_id = ?", admin);
    expect((await session(adminCookie)).news.entries.map((e: { version: string }) => e.version)).toContain(KABINE_VERSION);
  });

  it("lists modules the admin was not told about, only those offered for the club's sport", async () => {
    await session(adminCookie);
    await exec("UPDATE accounts SET modules_seen = ? WHERE person_id = ?", withoutIds("carpools", "handball4all"), admin);
    expect((await session(adminCookie)).news.newModules.map((m: { id: string }) => m.id).sort()).toEqual(["carpools", "handball4all"]);
    // handball4all is made for handball only
    await saveClub(env.DB, { sport: "football" });
    expect((await session(adminCookie)).news.newModules.map((m: { id: string }) => m.id)).toEqual(["carpools"]);
  });

  it("saving the module switches marks the modules as seen, the release notes stay", async () => {
    await session(adminCookie);
    await exec("UPDATE accounts SET changelog_seen = '0.0.1', modules_seen = ? WHERE person_id = ?", withoutIds("carpools"), admin);
    expect((await api("/admin/club", { method: "PUT", cookie: adminCookie, body: { modules: { carpools: true } } })).status).toBe(200);
    const news = (await session(adminCookie)).news;
    expect(news.newModules).toEqual([]);
    expect(news.entries.length).toBeGreaterThan(0);
  });

  it("coaches get only coach notes and may mark them; players get nothing", async () => {
    const wd = await team("wD", "wD");
    const coach = await person("Cora");
    const player = await person("Pia", { birthYear: 2014 });
    await member(coach, wd, "coach");
    await member(player, wd);
    const coachCookie = await loginAs(coach);
    // A coach without a mark starts with everything seen, without touching the module list
    expect((await session(coachCookie)).news).toBeNull();
    expect(await one("SELECT changelog_seen FROM accounts WHERE person_id = ?", coach)).toEqual({ changelog_seen: KABINE_VERSION });
    // After an update: only versions with coach notes, never the admin lines or modules
    await exec("UPDATE accounts SET changelog_seen = '0.0.1', modules_seen = NULL WHERE person_id = ?", coach);
    const news = (await session(coachCookie)).news;
    const withCoachNotes = newsEntries(entriesSince("0.0.1"), false);
    if (withCoachNotes.length) expect(news).toMatchObject({ entries: withCoachNotes, newModules: [] });
    else expect(news).toBeNull();
    expect((await api("/me/news-seen", { cookie: coachCookie, body: {} })).status).toBe(200);

    const playerCookie = await loginAs(player);
    await exec("UPDATE accounts SET changelog_seen = '0.0.1', modules_seen = '[]' WHERE person_id = ?", player);
    expect((await session(playerCookie)).news).toBeNull();
    expect((await api("/me/news-seen", { cookie: playerCookie, body: {} })).status).toBe(403);
  });

  it("coach notes: admins see both, coaches only versions with coach notes", () => {
    const entries: ChangelogEntry[] = [
      { version: "9.1.0", date: "2099-01-02", items: () => ["Admin line"], coaches: () => [{ text: "Coach line", example: "coach-buttons" }] },
      { version: "9.0.0", date: "2099-01-01", items: () => ["Only for admins"] },
    ];
    expect(newsEntries(entries, true)).toEqual([
      { version: "9.1.0", date: "2099-01-02", items: ["Admin line"], coachItems: [{ text: "Coach line", example: "coach-buttons" }] },
      { version: "9.0.0", date: "2099-01-01", items: ["Only for admins"], coachItems: [] },
    ]);
    expect(newsEntries(entries, false)).toEqual([{ version: "9.1.0", date: "2099-01-02", items: [], coachItems: [{ text: "Coach line", example: "coach-buttons" }] }]);
  });
});

describe("coach news: migration", () => {
  it("accounts from before the update count as having seen 0.6.0, the marks of admins stay", async () => {
    await upgradeFrom("202611071900_core_coach-news.sql");
    await exec("INSERT INTO persons (id, first_name) VALUES (901, 'Cora'), (902, 'Alma')");
    await exec("INSERT INTO accounts (person_id, webauthn_user_id) VALUES (901, 'u901')");
    await exec("INSERT INTO accounts (person_id, webauthn_user_id, changelog_seen, modules_seen) VALUES (902, 'u902', '0.5.0', '[]')");
    await migrateRest();
    expect(await one("SELECT changelog_seen, modules_seen FROM accounts WHERE person_id = 901")).toEqual({ changelog_seen: "0.6.0", modules_seen: null });
    expect(await one("SELECT changelog_seen FROM accounts WHERE person_id = 902")).toEqual({ changelog_seen: "0.5.0" });
  });
});
