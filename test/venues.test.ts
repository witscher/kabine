// Texts that name the place of play follow the club's sport: hall (handball), pitch (football) or neutral.
// Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseGameCsv } from "../shared/game-csv";
import { venueOf } from "../shared/sports";
import { saveClub } from "../worker/domain/club";
import { api, freshDb, loginAs, one, person } from "./helpers";

describe("venue wording", () => {
  beforeEach(freshDb);

  it("comes from the sport profile", () => {
    expect(venueOf("handball")).toBe("hall");
    expect(venueOf("football")).toBe("pitch");
    expect(venueOf("other")).toBe("venue");
    expect(venueOf("curling")).toBe("venue");
  });

  it("server messages say hall, pitch or neutral", async () => {
    const admin = await loginAs(await person("Alma", { admin: true }));
    const { id } = await one<{ id: number }>("INSERT INTO locations (name, kind) VALUES ('Vereinsgelände', 'hall') RETURNING id");
    const message = async () => (await api(`/locations/${id}`, { method: "DELETE", cookie: admin })).body.error.message as string;
    await saveClub(env.DB, { sport: "handball" });
    expect(await message()).toBe("Die Vereinshallen können nicht gelöscht werden.");
    await saveClub(env.DB, { sport: "football" });
    expect(await message()).toBe("Die Vereinsplätze können nicht gelöscht werden.");
    await saveClub(env.DB, { sport: "other" });
    expect(await message()).toBe("Die eigenen Spielstätten des Vereins können nicht gelöscht werden.");
  });

  it("the game table accepts Halle, Platz and Ort as the venue column", () => {
    for (const header of ["Halle", "Platz", "Ort", "Pitch", "Venue"]) {
      const { games } = parseGameCsv(`Datum;Uhrzeit;Gegner;Heim;${header}\n05.05.2099;15:00;SG Testdorf;H;Sportplatz Nord`);
      expect(games[0]?.venue, header).toBe("Sportplatz Nord");
    }
  });
});
