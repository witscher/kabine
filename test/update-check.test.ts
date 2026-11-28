// Update notices (worker/domain/releases.ts): the daily fetch of kabine.dev/releases.json, the off switch, one push
// per new version to the admins, the hint in the administration and the "Install update" link. kabine.dev is never
// called: the fetch is a fake. Names invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KABINE_VERSION } from "../shared/changelog";
import { availableUpdate, compareRelease, githubRepo, parseReleaseFeed, RELEASES_URL, updatePullRequestUrl } from "../shared/releases";
import type { PushJob } from "../worker/domain/notify";
import { checkForUpdates, loadUpdateCheck } from "../worker/domain/releases";
import { api, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

/** A version after the installed one */
const bump = (v: string, by = 1) => {
  const [a, b, c] = v.split(".").map(Number);
  return `${a}.${b}.${c! + by}`;
};
const NEXT = bump(KABINE_VERSION);
const LATER = bump(KABINE_VERSION, 2);

const release = (version: string, security = false) => ({ version, date: "2026-12-01", notes: `https://kabine.dev/en/news/#v${version.replace(/\./g, "-")}`, security });
const feed = (...versions: ReturnType<typeof release>[]) => ({ latest: versions[0], versions });

/** 12:00 UTC is after 10 o'clock in the club's time zone; day n after a fixed start */
const noon = (day = 0) => Date.parse("2026-12-02T12:00:00Z") + day * 86_400_000;

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(body: unknown, status = 200) {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

let ada: number;
let ben: number;
let tara: number;
let adaCookie: string;
let taraCookie: string;
let pushes: PushJob[];
const accountOf = async (personId: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;

beforeEach(async () => {
  await freshDb();
  await season();
  const wd = await team("wD", "wD");
  ada = await person("Ada", { admin: true });
  ben = await person("Ben", { admin: true });
  tara = await person("Tara");
  await member(tara, wd, "coach");
  adaCookie = await loginAs(ada);
  await loginAs(ben);
  taraCookie = await loginAs(tara);
  await exec("UPDATE accounts SET locale = 'en' WHERE person_id = ?", ben);
  await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
  pushes = [];
  vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
    pushes.push(...[...jobs].map((j) => j.body as PushJob));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("releases.json", () => {
  it("parses the feed and ignores what does not fit", () => {
    expect(parseReleaseFeed(feed(release("1.0.1", true), release("1.0.0")))).toEqual({ latest: release("1.0.1", true), versions: [release("1.0.1", true), release("1.0.0")] });
    expect(parseReleaseFeed({ latest: { version: "1.0", date: "2026-12-01" } })).toBeNull();
    expect(parseReleaseFeed("<html>")).toBeNull();
    expect(parseReleaseFeed(null)).toBeNull();
    // Links only to kabine.dev; the latest is in the list even if the file forgot it
    const odd = parseReleaseFeed({ latest: { ...release("1.0.2"), notes: "https://evil.example/" }, versions: [release("1.0.1"), { version: "x" }] })!;
    expect(odd.latest.notes).toBe("https://kabine.dev/en/news/");
    expect(odd.versions.map((r) => r.version)).toEqual(["1.0.2", "1.0.1"]);
  });

  it("compares versions with test versions before their release", () => {
    expect(compareRelease("1.0.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareRelease("0.10.0", "0.9.1")).toBeGreaterThan(0);
    expect(compareRelease("1.0.0", "1.0.0-rc.3")).toBeGreaterThan(0);
    expect(compareRelease("1.0.0-rc.3", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareRelease("v1.0.0", "1.0.0")).toBe(0);
  });

  it("a security release since the installed version marks the update, also when a later one is not", () => {
    const f = parseReleaseFeed(feed(release("1.0.2"), release("1.0.1", true), release("1.0.0")))!;
    expect(availableUpdate(f, "1.0.0", null, "en")).toMatchObject({ version: "1.0.2", security: true, pullRequest: false, installUrl: "https://kabine.dev/en/docs/operation/#installing-an-update" });
    expect(availableUpdate(f, "1.0.1", null, "de")).toMatchObject({ security: false, installUrl: "https://kabine.dev/docs/betrieb/#ein-update-installieren" });
    expect(availableUpdate(f, "1.0.2", "sv-muster/kabine", "en")).toBeNull();
  });

  it("knows a GitHub copy only by owner and name", () => {
    expect(githubRepo("https://github.com/sv-muster/kabine")).toBe("sv-muster/kabine");
    expect(githubRepo("https://x-access-token:secret@github.com/sv-muster/vereinsapp.git")).toBe("sv-muster/vereinsapp");
    expect(githubRepo("git@github.com:sv-muster/kabine.git")).toBe("sv-muster/kabine");
    expect(githubRepo("https://gitlab.com/sv-muster/kabine")).toBeNull();
    expect(githubRepo("https://github.com/sv-muster")).toBeNull();
    expect(githubRepo("http://github.com/sv-muster/kabine")).toBeNull();
    expect(updatePullRequestUrl("sv-muster/kabine", "1.0.1")).toBe("https://github.com/sv-muster/kabine/pulls?q=is%3Apr+head%3Akabine-update-v1.0.1");
  });
});

describe("the daily check", () => {
  it("fetches once a day, from 10 o'clock, with a plain request and nothing about the club", async () => {
    const { fetcher, seen } = fakeFetch(feed(release(KABINE_VERSION)));
    expect(await checkForUpdates(env, Date.parse("2026-12-02T06:00:00Z"), fetcher)).toBe("not due");
    expect(seen).toHaveLength(0);
    expect(await checkForUpdates(env, noon(), fetcher)).toBe("checked");
    expect(await checkForUpdates(env, noon() + 3_600_000, fetcher)).toBe("not due");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(RELEASES_URL);
    const headers = new Headers(seen[0]!.init?.headers);
    expect([...headers.keys()].sort()).toEqual(["accept", "user-agent"]);
    expect(headers.get("user-agent")).toBe(`Kabine/${KABINE_VERSION}`);
    expect(seen[0]!.init?.method ?? "GET").toBe("GET");
    expect(seen[0]!.init?.body).toBeUndefined();
    expect(await checkForUpdates(env, noon(1), fetcher)).toBe("checked");
    expect(seen).toHaveLength(2);
    // Up to date: nobody is told
    expect(pushes).toEqual([]);
  });

  it("ignores failures and tries again the next day", async () => {
    const broken = fakeFetch({ nothing: true });
    const down = fakeFetch("", 503);
    const throwing = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await checkForUpdates(env, noon(), broken.fetcher)).toBe("failed");
    expect(await checkForUpdates(env, noon(), broken.fetcher)).toBe("not due");
    expect(await checkForUpdates(env, noon(1), down.fetcher)).toBe("failed");
    expect(await checkForUpdates(env, noon(2), throwing)).toBe("failed");
    expect((await loadUpdateCheck(env.DB)).feed).toBeNull();
    const ok = fakeFetch(feed(release(NEXT)));
    expect(await checkForUpdates(env, noon(3), ok.fetcher)).toBe("checked");
    expect((await loadUpdateCheck(env.DB)).feed?.latest.version).toBe(NEXT);
  });

  it("switched off, nothing is fetched and nothing shown; on again, it checks the same day", async () => {
    const { fetcher, seen } = fakeFetch(feed(release(NEXT)));
    expect((await api("/admin/update-check", { method: "PUT", body: { on: false }, cookie: taraCookie })).status).toBe(403);
    await checkForUpdates(env, noon(), fetcher);
    expect((await api("/session", { cookie: adaCookie })).body.me.update).toMatchObject({ version: NEXT });
    expect((await api("/admin/update-check", { method: "PUT", body: { on: false }, cookie: adaCookie })).body).toEqual({ on: false });
    expect(await checkForUpdates(env, noon(1), fetcher)).toBe("off");
    expect(seen).toHaveLength(1);
    expect((await api("/session", { cookie: adaCookie })).body.me.update).toBeNull();
    expect((await api("/admin/updates", { cookie: adaCookie })).body).toMatchObject({ available: null, check: { on: false, fetchedAt: null } });
    await api("/admin/update-check", { method: "PUT", body: { on: true }, cookie: adaCookie });
    expect(await checkForUpdates(env, noon(1), fetcher)).toBe("checked");
    expect(seen).toHaveLength(2);
  });
});

describe("push to the admins", () => {
  it("one push per new version, to admins only, in each admin's language", async () => {
    const next = fakeFetch(feed(release(NEXT)));
    await checkForUpdates(env, noon(), next.fetcher);
    expect(pushes).toHaveLength(2);
    const byAccount = Object.fromEntries(pushes.flatMap((p) => p.accountIds.map((a) => [a, p.payload])));
    expect(Object.keys(byAccount).map(Number).sort()).toEqual([await accountOf(ada), await accountOf(ben)].sort());
    expect(byAccount[await accountOf(ben)]).toMatchObject({ title: `Kabine ${NEXT} is available`, url: "/verwaltung/updates" });
    expect(byAccount[await accountOf(ada)]!.title).toContain(NEXT);
    expect(byAccount[await accountOf(ada)]!.title).not.toBe(`Kabine ${NEXT} is available`);
    expect((await loadUpdateCheck(env.DB)).notified).toBe(NEXT);

    // The same version again: no second push, not the next day either
    pushes.length = 0;
    await checkForUpdates(env, noon(1), next.fetcher);
    await checkForUpdates(env, noon(2), next.fetcher);
    expect(pushes).toEqual([]);

    // A later version: one more
    await checkForUpdates(env, noon(3), fakeFetch(feed(release(LATER), release(NEXT))).fetcher);
    expect(pushes.flatMap((p) => p.accountIds)).toHaveLength(2);
    expect(pushes[0]!.payload.title).toContain(LATER);
  });

  it("a security release says so; admins who switched the topic off or work as parents get none", async () => {
    // Ben switches the topic off, Ada works as a parent ("Work as admin" off)
    const kid = await person("Kim", { birthYear: 2015 });
    await guardian(ada, kid);
    await exec("UPDATE accounts SET coach_mode = 1 WHERE person_id = ?", ada);
    expect((await api("/me/notifications", { method: "PUT", body: { personId: ben, topic: "updates", enabled: false }, cookie: await loginAs(ben) })).status).toBe(200);
    const carla = await person("Carla", { admin: true });
    await loginAs(carla);
    await exec("UPDATE accounts SET locale = 'en' WHERE person_id = ?", carla);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/c' || id, 'k', 'a' FROM accounts WHERE person_id = ?", carla);
    await checkForUpdates(env, noon(), fakeFetch(feed(release(NEXT, true))).fetcher);
    expect(pushes.flatMap((p) => p.accountIds)).toEqual([await accountOf(carla)]);
    expect(pushes[0]!.payload.title).toBe(`Security update: Kabine ${NEXT}`);
  });

  it("only admins see the topic in their notification settings", async () => {
    const topics = async (cookie: string) => Object.keys((await api("/me/notifications", { cookie })).body.persons[0].topics);
    expect(await topics(adaCookie)).toContain("updates");
    expect(await topics(taraCookie)).not.toContain("updates");
    expect((await api("/me/notifications", { method: "PUT", body: { personId: tara, topic: "updates", enabled: false }, cookie: taraCookie })).status).toBe(200);
  });
});

describe("the hint and the install button", () => {
  it("admins get the newer version in their session, coaches never", async () => {
    expect((await api("/session", { cookie: adaCookie })).body.me.update).toBeNull();
    await checkForUpdates(env, noon(), fakeFetch(feed(release(NEXT))).fetcher);
    const update = (await api("/session", { cookie: adaCookie })).body.me.update;
    expect(update).toMatchObject({ version: NEXT, date: "2026-12-01", security: false, pullRequest: false });
    // The test club speaks German: the guide in German
    expect(update.installUrl).toBe("https://kabine.dev/docs/betrieb/#ein-update-installieren");
    expect((await api("/session", { cookie: taraCookie })).body.me.update).toBeNull();
    expect((await api("/admin/updates", { cookie: adaCookie })).body).toMatchObject({ available: { version: NEXT }, check: { on: true, latest: NEXT }, repo: null });
  });

  it("opens the update pull request of the club's copy when the deploy found it, else the source code link's", async () => {
    await checkForUpdates(env, noon(), fakeFetch(feed(release(NEXT))).fetcher);
    await exec("UPDATE app_meta SET value = json_set(value, '$.sourceUrl', 'https://github.com/sv-muster/vereinsapp') WHERE key = 'club'");
    expect((await api("/session", { cookie: adaCookie })).body.me.update.installUrl).toBe(updatePullRequestUrl("sv-muster/vereinsapp", NEXT));
    const last = { at: "2026-11-30T03:00:00Z", version: KABINE_VERSION, migrations: [], bookmark: null, repo: "sv-muster/kabine" };
    await exec("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_update', ?)", JSON.stringify(last));
    const update = (await api("/session", { cookie: adaCookie })).body.me.update;
    expect(update).toMatchObject({ pullRequest: true, installUrl: `https://github.com/sv-muster/kabine/pulls?q=is%3Apr+head%3Akabine-update-v${NEXT}` });
    expect((await api("/admin/updates", { cookie: adaCookie })).body.repo).toBe("sv-muster/kabine");
    // The Kabine repository itself is never a club's copy
    await exec("UPDATE app_meta SET value = json_set(value, '$.repo', 'witscher/kabine') WHERE key = 'last_update'");
    await exec("UPDATE app_meta SET value = json_set(value, '$.sourceUrl', 'https://github.com/witscher/kabine') WHERE key = 'club'");
    expect((await api("/session", { cookie: adaCookie })).body.me.update.pullRequest).toBe(false);
  });
});
