// Language of server texts: account setting, else the app's language (header), else the club default.
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { matchLocale } from "../shared/i18n";
import { currentLocale, withLocale } from "../worker/i18n";
import { notFound } from "../worker/lib/http";
import { api, exec, freshDb, loginAs, one, person, season } from "./helpers";

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

describe("Sprache am Konto", () => {
  it("PUT /api/me/locale speichert die Sprache, null setzt sie zurück", async () => {
    const ada = await person("Ada");
    const cookie = await loginAs(ada);
    expect((await api("/session", { cookie })).body.me.locale).toBeNull();
    expect((await api("/me/locale", { method: "PUT", cookie, body: { locale: "en" } })).status).toBe(200);
    expect((await one<{ locale: string | null }>("SELECT locale FROM accounts WHERE person_id = ?", ada)).locale).toBe("en");
    const session = await api("/session", { cookie });
    expect(session.body.me.locale).toBe("en");
    // Texts now follow the account, not the club default
    expect((await api("/me/locale", { method: "PUT", cookie, body: { locale: "fr" } })).body.error.message).toBe("Invalid input. (locale)");
    await api("/me/locale", { method: "PUT", cookie, body: { locale: null } });
    expect((await api("/session", { cookie })).body.me.locale).toBeNull();
    expect((await api("/me/locale", { method: "PUT", body: { locale: "en" } })).status).toBe(401);
  });
});

describe("Sprache am Konto", () => {
  it("merkt sich die Sprache der App beim ersten Aufruf, eine eigene Wahl bleibt", async () => {
    await freshDb();
    await season();
    const ida = await person("Ida");
    const cookie = await loginAs(ida);
    await exports.default.fetch(new Request("http://localhost:5173/api/session", { headers: { cookie, "x-kabine-locale": "en" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await one<{ locale: string }>("SELECT locale FROM accounts WHERE person_id = ?", ida)).toEqual({ locale: "en" });
    await exports.default.fetch(new Request("http://localhost:5173/api/session", { headers: { cookie, "x-kabine-locale": "de" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await one<{ locale: string }>("SELECT locale FROM accounts WHERE person_id = ?", ida)).toEqual({ locale: "en" });
  });
});
