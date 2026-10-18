// Public demo installation (APP_ENV "demo"): every night at 3:00 the database, the logo and the chats are
// wiped and filled again with the invented club of seed/demo.sql plus a few scenes (games, responses,
// squads, helper duties, carpool, chat), made through the app's own API like real use.
import demoSeed from "../../seed/demo.sql?raw";
import { createSession, SESSION_COOKIE } from "../auth/session";
import { clearChats, postChatMessage } from "../domain/chat";
import { enterClubContext } from "../domain/club";
import { ensureGenerated } from "../domain/generate";
import { all, batch, run } from "../lib/db";
import { addDays, todayLocal } from "../lib/time";
import { splitSql } from "./split-sql";

/** People with a sign-in link on the website (the roles) and the people who answer in the scenes. */
export const DEMO_ROLES = {
  player: 202, // Lea Beispiel, wD
  parent: 501, // Petra Muster, mother of Mia (wD)
  coach: 101, // Clara Coach, coach of wD
  admin: 100, // Alex Admin
} as const;
export type DemoRole = keyof typeof DEMO_ROLES;

const ADMIN = 100;
const CLARA = 101;
const LEA = 202;
const MIA = 201;
const PETRA = 501;
const WD_PLAYERS = [201, 202, 203, 204, 205, 206, 207, 208];
const TEAMS = [1, 2, 3];
const KEEP_KV = new Set(["maintenance"]);

/** Hour (0-23) in the demo club's time zone, to run the reset at 3:00 local time. */
export function demoLocalHour(time: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(time));
}

async function wipe(env: Env): Promise<void> {
  const tables = await all<{ name: string }>(
    env.DB,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
        AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\' AND name <> 'instance_secrets'`,
  );
  // One transaction: foreign keys are checked at the end, so the order of the tables does not matter
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = on"),
    ...tables.map((t) => env.DB.prepare(`DELETE FROM "${t.name}"`)),
    env.DB.prepare("DELETE FROM sqlite_sequence"),
  ]);
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ cursor });
    await Promise.all(page.keys.filter((k) => !KEEP_KV.has(k.name)).map((k) => env.KV.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await clearChats(env, TEAMS);
}

/** The seed describes season 2026/27 with birth years of that season; move it to the current season. */
async function redate(env: Env, now: number): Promise<void> {
  const [year, month] = todayLocal(now).split("-").map(Number) as [number, number];
  const start = month >= 7 ? year : year - 1;
  const shift = start - 2026;
  const name = `${start}/${String(start + 1).slice(2)}`;
  await env.DB.batch([
    env.DB.prepare("UPDATE seasons SET name = ?, starts_on = ?, ends_on = ? WHERE id = 1").bind(name, `${start}-07-01`, `${start + 1}-06-30`),
    env.DB.prepare("UPDATE training_plans SET name = ?, valid_from = ?, valid_to = ?").bind(`Trainingsplan ${name}`, `${start}-07-01`, `${start + 1}-06-30`),
    env.DB.prepare("UPDATE age_classes SET birth_year_min = birth_year_min + ?, birth_year_max = birth_year_max + ?").bind(shift, shift),
    env.DB.prepare("UPDATE persons SET birth_year = birth_year + ? WHERE birth_year IS NOT NULL").bind(shift),
  ]);
}

async function seed(env: Env, now: number): Promise<void> {
  await batch(env.DB, splitSql(demoSeed).map((s) => env.DB.prepare(s)));
  await redate(env, now);
  const people = [ADMIN, CLARA, 102, 103, ...WD_PLAYERS, 301, 302, 401, PETRA, 502];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO persons (id, first_name, last_name, is_admin) VALUES (?, 'Alex', 'Admin', 1)").bind(ADMIN),
    env.DB.prepare("UPDATE app_meta SET value = json_set(value, '$.ownerPersonId', ?) WHERE key = 'club'").bind(ADMIN),
    env.DB.prepare("UPDATE teams SET helper_plan = 1 WHERE id IN (1, 2)"),
    ...people.map((id) => env.DB.prepare("INSERT INTO accounts (id, person_id, webauthn_user_id) VALUES (?, ?, ?)").bind(id, id, `demo-${id}`)),
  ]);
  await enterClubContext(env.DB);
  await ensureGenerated(env.DB, now);
}

type Fetch = (request: Request) => Promise<Response>;

/** Sign-in for the demo roles: a session for the fixed demo person (the link on the website). */
export async function demoSession(env: Env, role: DemoRole, userAgent: string | null): Promise<{ token: string; expiresAt: number }> {
  const personId = DEMO_ROLES[role];
  return createSession(env.DB, personId, userAgent);
}

async function scenes(env: Env, fetchApp: Fetch, now: number): Promise<void> {
  const tokens = new Map<number, string>();
  const call = async <T>(personId: number, method: string, path: string, body?: unknown): Promise<T> => {
    let token = tokens.get(personId);
    if (!token) {
      token = (await createSession(env.DB, personId, "Demo")).token;
      tokens.set(personId, token);
    }
    const res = await fetchApp(
      new Request(`https://demo.internal/api${path}`, {
        method,
        headers: { cookie: `${SESSION_COOKIE}=${token}`, "x-kabine-locale": "de", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const day = (offset: number) => addDays(todayLocal(now), offset);

  try {
    // Helper duty types and game templates of the handball profile, as the setup wizard creates them
    await call(ADMIN, "POST", "/admin/setup/sport", { sport: "handball" });
    const { events } = await call<{ events: { id: number; kind: string; teams: { id: number }[] }[] }>(CLARA, "GET", "/events?limit=20");
    const training = events.find((e) => e.kind === "training" && e.teams.some((t) => t.id === 1))!.id;

    const home = (await call<{ id: number }>(CLARA, "POST", "/duties/teams/1/games", { opponent: "HSG Nachbarort", isHome: true, date: day(5), time: "14:00" })).id;
    const away = (await call<{ id: number }>(CLARA, "POST", "/duties/teams/1/games", { opponent: "TSV Weitweg", isHome: false, date: day(12), time: "15:30" })).id;
    for (const game of [home, away]) await call(CLARA, "PUT", `/events/${game}/squad`, { personIds: WD_PLAYERS.slice(0, 7) });

    // Responses to the next training: most accept, two decline with a reason, the rest is open
    for (const pid of [202, 203, 204, 205]) await call(pid, "POST", `/events/${training}/responses`, { personId: pid, status: "yes" });
    await call(206, "POST", `/events/${training}/responses`, { personId: 206, status: "no", reason: "Erkältet" });
    await call(207, "POST", `/events/${training}/responses`, { personId: 207, status: "no", reason: "Klassenfahrt" });
    await call(PETRA, "POST", `/events/${training}/responses`, { personId: MIA, status: "yes" });

    // Helper duties of the home game: a parent brings a cake
    const plan = await call<{ games: { id: number; blocks: { id: number; noteAllowed: boolean }[] }[] }>(PETRA, "GET", "/duties?teamId=1");
    const cake = plan.games.find((g) => g.id === home)?.blocks.find((b) => b.noteAllowed);
    if (cake) await call(PETRA, "POST", "/duties", { blockId: cake.id, childId: MIA, note: "Apfelkuchen" });

    // Carpool to the away game: Petra drives, Lea has booked a seat, Emma is still looking
    await call(PETRA, "PUT", `/events/${away}/carpool/offers/${PETRA}`, { seats: 3 });
    await call(LEA, "PUT", `/events/${away}/carpool/requests/${LEA}`, { companions: 0 });
    const detail = await call<{ modules: { carpools: { offers: { id: number }[] } } }>(LEA, "GET", `/events/${away}`);
    await call(LEA, "PUT", `/events/${away}/carpool/requests/${LEA}/booking`, { offerId: detail.modules.carpools.offers[0]!.id });
    await call(203, "PUT", `/events/${away}/carpool/requests/203`, { companions: 0 });

    // Chat of the wD
    await postChatMessage(env, 1, { personId: CLARA, name: "Clara C." }, "Am Samstag treffen wir uns um 13:15 Uhr an der Halle. Bitte an die Trikots denken!");
    await postChatMessage(env, 1, { personId: PETRA, name: "Petra M." }, "Mia ist dabei. Ich kann zwei Kinder mitnehmen.");
    await postChatMessage(env, 1, { personId: LEA, name: "Lea B." }, "Ich bringe die Bälle mit 🙂");
  } catch (err) {
    // A half-filled demo is better than none
    console.error("Demo reset: scenes failed", err);
  } finally {
    await run(env.DB, "DELETE FROM sessions");
  }
}

/** Wipes the demo installation and fills it again. `fetchApp` is the app's own fetch handler. */
export async function resetDemo(env: Env, fetchApp: Fetch, now = Date.now()): Promise<void> {
  await wipe(env);
  await seed(env, now);
  await scenes(env, fetchApp, now);
  console.log("Demo reset done");
}
