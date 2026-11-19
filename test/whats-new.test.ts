// Help → What's new: release notes for players and parents since the club's start. Names invented.
import { describe, expect, it } from "vitest";
import { CHANGELOG, type ChangelogEntry, everyone, everyoneEntries, itemText } from "../shared/changelog";
import { newsEntries } from "../worker/domain/news";
import { api, exec, one, person, upgradeFrom, migrateRest } from "./helpers";

const entries: ChangelogEntry[] = [
  { version: "0.3.0", date: "2026-11-20", items: () => [everyone("Chat for everyone"), "Admin page"] },
  { version: "0.2.0", date: "2026-11-01", items: () => ["Only for admins"] },
  { version: "0.1.0", date: "2026-10-01", items: () => [everyone("First release")] },
];

describe("What's new", () => {
  it("lists only the items marked for everyone, releases without one are left out", () => {
    expect(everyoneEntries(null, entries)).toEqual([
      { version: "0.3.0", date: "2026-11-20", items: ["Chat for everyone"] },
      { version: "0.1.0", date: "2026-10-01", items: ["First release"] },
    ]);
  });

  it("starts after the day the club started with the app", () => {
    expect(everyoneEntries("2026-10-01", entries).map((e) => e.version)).toEqual(["0.3.0"]);
    expect(everyoneEntries("2026-11-20", entries)).toEqual([]);
  });

  it("admins still read every item as plain text", () => {
    expect(newsEntries(entries, true)[0]!.items).toEqual(["Chat for everyone", "Admin page"]);
  });

  it("the real release notes have items for everyone, with text", () => {
    const all = CHANGELOG.flatMap((e) => e.items());
    expect(all.some((i) => typeof i !== "string")).toBe(true);
    for (const i of all) expect(itemText(i).trim()).not.toBe("");
    expect(everyoneEntries(null).at(-1)!.version).toBe("0.1.0");
  });
});

describe("migration 202611200400_core_club-started-on.sql", () => {
  it("existing clubs start on the day of their first access", async () => {
    await upgradeFrom("202611200400_core_club-started-on.sql");
    await exec("UPDATE app_meta SET value = json_set(value, '$.setupDone', json('true')) WHERE key = 'club'");
    const ada = await person("Ada", { admin: true });
    const kim = await person("Kim");
    await exec("INSERT INTO accounts (person_id, webauthn_user_id, created_at) VALUES (?, 'uid-a', '2026-10-12T18:30:00.000Z')", ada);
    await exec("INSERT INTO accounts (person_id, webauthn_user_id, created_at) VALUES (?, 'uid-k', '2026-10-20T08:00:00.000Z')", kim);
    await migrateRest();
    expect((await api("/club")).body).toMatchObject({ setupDone: true, startedOn: "2026-10-12", defaultLocale: "de" });
  });

  it("without any access nothing is known yet; the setup sets it later", async () => {
    await upgradeFrom("202611200400_core_club-started-on.sql");
    await migrateRest();
    expect(await one("SELECT json_extract(value, '$.startedOn') AS startedOn FROM app_meta WHERE key = 'club'")).toEqual({ startedOn: null });
    expect((await api("/club")).body.startedOn).toBeNull();
  });
});
