// __NAME__: API tests. Invented names only.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODULES } from "../../../shared/modules";
import { saveClub } from "../../../worker/domain/club";
import { api, freshDb, loginAs, person } from "../../../test/helpers";

describe("__NAME__", () => {
  beforeEach(freshDb);

  it("answers while the club has switched it on", async () => {
    const cookie = await loginAs(await person("Mila"));
    expect((await api("/__FOLDER__/hello", { cookie })).status).toBe(404);
    await saveClub(env.DB, { modules: { ...DEFAULT_MODULES, __ID__: true } });
    const res = await api("/__FOLDER__/hello", { cookie });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: "Mila" });
  });
});
