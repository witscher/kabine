// Own name: only admins change it; coaches correct players and parents of their teams. Names invented.
import { describe, expect, it } from "vitest";
import { api, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

describe("own name", () => {
  it("players, parents and coaches cannot rename themselves; coaches and admins correct others", async () => {
    await freshDb();
    await season();
    const wd = await team("wD", "wD");
    const coach = await person("Tina", { lastName: "Trainer" });
    const lina = await person("Lina", { lastName: "Muster" });
    const mother = await person("Maren", { lastName: "Muster" });
    const admin = await person("Ada", { lastName: "Admin", admin: true });
    await member(coach, wd, "coach");
    await member(lina, wd);
    await guardian(mother, lina);
    const rename = (id: number, cookie: string, firstName = "Neu") => api(`/persons/${id}`, { method: "PATCH", cookie, body: { firstName } });

    for (const [id, cookie] of [
      [lina, await loginAs(lina)],
      [mother, await loginAs(mother)],
      [coach, await loginAs(coach)],
    ] as const) {
      const res = await rename(id, cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("name_locked");
    }
    const coachCookie = await loginAs(coach);
    expect((await rename(lina, coachCookie, "Linda")).status).toBe(200);
    expect((await rename(mother, coachCookie, "Marion")).status).toBe(200);
    expect((await rename(admin, await loginAs(admin), "Adele")).status).toBe(200);
    expect(await one("SELECT first_name FROM persons WHERE id = ?", mother)).toEqual({ first_name: "Marion" });

    // An admin working as a coach keeps it
    await member(admin, wd, "coach");
    await exec("UPDATE accounts SET coach_mode = 1 WHERE person_id = ?", admin);
    expect((await rename(admin, await loginAs(admin), "Ada")).status).toBe(200);
  });
});
