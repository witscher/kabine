// What is new for admins: release notes after an update and modules they were not told about. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { KABINE_VERSION } from "../shared/changelog";
import { MODULES } from "../shared/modules";
import { saveClub } from "../worker/domain/club";
import { api, exec, freshDb, loginAs, member, one, person, season, team } from "./helpers";

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

  it("coaches and players never get news and cannot mark them", async () => {
    const wd = await team("wD", "wD");
    const coach = await person("Cora");
    const player = await person("Pia", { birthYear: 2014 });
    await member(coach, wd, "coach");
    await member(player, wd);
    for (const id of [coach, player]) {
      const cookie = await loginAs(id);
      await exec("UPDATE accounts SET changelog_seen = '0.0.1', modules_seen = '[]' WHERE person_id = ?", id);
      expect((await session(cookie)).news).toBeNull();
      expect((await api("/me/news-seen", { cookie, body: {} })).status).toBe(403);
    }
  });
});
