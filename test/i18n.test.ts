// Language of server texts: account setting, else the app's language (header), else the club default.
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { matchLocale } from "../shared/i18n";
import { currentLocale, withLocale } from "../worker/i18n";
import { notFound } from "../worker/lib/http";
import { exec, freshDb, loginAs, person, season } from "./helpers";

async function message(headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(new Request("http://localhost:5173/api/teams", { headers }));
  return ((await res.json()) as any).error.message as string;
}

beforeEach(async () => {
  await freshDb();
  await season();
});

describe("Sprache", () => {
  it("Vorgabe des Vereins, Sprache der App, Einstellung am Konto", async () => {
    expect(await message()).toBe("Bitte melde dich an.");
    expect(await message({ "x-kabine-locale": "en" })).toBe("Please sign in.");
    expect(await message({ "x-kabine-locale": "xx" })).toBe("Bitte melde dich an.");
    const ada = await person("Ada");
    const cookie = await loginAs(ada);
    await exec("UPDATE accounts SET locale = 'en' WHERE person_id = ?", ada);
    const res = await exports.default.fetch(
      new Request("http://localhost:5173/api/me/email", { method: "PUT", headers: { cookie, "x-kabine-locale": "de", "content-type": "text/plain" }, body: "x" }),
    );
    expect(((await res.json()) as any).error.message).toBe("Expected JSON.");
  });

  it("Texte für andere in deren Sprache", () => {
    expect(withLocale("en", () => notFound().message)).toBe("Not found.");
    expect(withLocale("de", () => notFound().message)).toBe("Nicht gefunden.");
    expect(withLocale("en", () => currentLocale())).toBe("en");
  });

  it("erkennt die Sprache des Browsers", () => {
    expect(matchLocale(["fr-FR", "de-AT"])).toBe("de");
    expect(matchLocale("en-GB,en;q=0.9")).toBe("en");
    expect(matchLocale(["fr"])).toBeNull();
  });
});
