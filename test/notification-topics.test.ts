// Notification topics of modules: the table no longer checks topics, the code does (worker/routes/parents.ts).
// Names invented.
import { describe, expect, it } from "vitest";
import { exec, loginAs, migrateRest, person, rows, upgradeFrom } from "./helpers";

describe("Benachrichtigungsthemen", () => {
  it("Upgrade: bestehende Einstellungen bleiben, ein Thema eines Moduls lässt sich speichern", async () => {
    await upgradeFrom("202611200100_core_notification-topics.sql");
    const nora = await person("Nora");
    await loginAs(nora);
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) SELECT id, person_id, 'chat', 0 FROM accounts WHERE person_id = ?", nora);
    await expect(exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) SELECT id, person_id, 'polls', 0 FROM accounts WHERE person_id = ?", nora)).rejects.toThrow();
    await migrateRest();
    await exec("INSERT INTO notification_settings (account_id, person_id, topic, enabled) SELECT id, person_id, 'polls', 0 FROM accounts WHERE person_id = ?", nora);
    expect(await rows("SELECT topic, enabled FROM notification_settings ORDER BY topic")).toEqual([
      { topic: "chat", enabled: 0 },
      { topic: "polls", enabled: 0 },
    ]);
  });
});
