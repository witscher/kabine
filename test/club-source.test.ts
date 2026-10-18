// AGPL: the source code link of an installation can point to the club's own copy.
import { describe, expect, it } from "vitest";
import { api, freshDb, loginAs, person } from "./helpers";

describe("Quellcode-Link", () => {
  it("leer ist der Kabine-Link, sonst nur https", async () => {
    await freshDb();
    const cookie = await loginAs(await person("Ada", { admin: true }));
    expect((await api("/club")).body.sourceUrl).toBeNull();
    expect((await api("/admin/club", { method: "PUT", cookie, body: { sourceUrl: "http://example.org/kabine" } })).status).toBe(400);
    expect((await api("/admin/club", { method: "PUT", cookie, body: { sourceUrl: "https://example.org/kabine" } })).status).toBe(200);
    expect((await api("/club")).body.sourceUrl).toBe("https://example.org/kabine");
  });
});
