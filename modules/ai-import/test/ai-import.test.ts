// AI list import: access to the API, and reading the model's answers with a fake model. Invented data only.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { saveClub } from "../../../worker/domain/club";
import { api, freshDb, loginAs, person } from "../../../test/helpers";
import { readColumns, type Run } from "../worker/routes";

describe("AI list import", () => {
  beforeEach(freshDb);

  it("only for admins and only while switched on", async () => {
    const admin = await loginAs(await person("Ada", { admin: true }));
    const body = { header: ["Mannschaft"], samples: [] };
    expect((await api("/ai-import/columns", { cookie: admin, body })).status).toBe(404);
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, aiImport: true } });
    expect((await api("/ai-import/columns", { cookie: await loginAs(await person("Theo")), body })).status).toBe(403);
    expect((await api("/ai-import/columns", { cookie: admin, body: { header: [], samples: [] } })).status).toBe(400);
    // Names are never sent: the route for them is gone
    expect((await api("/ai-import/names", { cookie: admin, body: { cells: ["Kim Muster"] } })).status).toBe(404);
  });

  it("columns: one kind per column, sure answers only, samples only where sent", async () => {
    const states: string[] = [];
    const run: Run = async (state) => {
      states.push(state);
      return { column_1: { value: "team", confidence: 0.9 }, column_2: { value: "full_name", confidence: 0.9 }, column_3: { value: "birth_year", confidence: 0.4 } };
    };
    expect(await readColumns(run, ["", "Akteur", "J"], [["wD1", "", "14"]])).toEqual(["team", "name", "ignore"]);
    expect(states[0]).toContain("Column 1: (no header) (examples: wD1)\nColumn 2: Akteur\nColumn 3: J (examples: 14)");
  });
});
