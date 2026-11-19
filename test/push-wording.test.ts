// Push texts per recipient: parents read their child's name instead of "you" (worker/domain/notify.ts). Names invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areYouComing, ifYouCannot, notifyPersons, type PushJob } from "../worker/domain/notify";
import { withLocale } from "../worker/i18n";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, one, person, season, team } from "./helpers";

describe("wording", () => {
  it("you, one child, several, you and children, in English and German", () => {
    const you = { self: true, others: [] };
    const one = { self: false, others: ["Anna"] };
    const two = { self: false, others: ["Anna", "Ben"] };
    const youAnd = { self: true, others: ["Anna", "Ben"] };
    withLocale("en", () => {
      expect(areYouComing(you)).toBe("Are you coming?");
      expect(areYouComing(one)).toBe("Is Anna coming?");
      expect(areYouComing(youAnd)).toBe("Are you, Anna, and Ben coming?");
      expect(ifYouCannot(one)).toBe("If Anna can't make it, please decline.");
      expect(ifYouCannot(two)).toBe("If someone can't make it, please decline.");
    });
    withLocale("de", () => {
      expect(areYouComing(you)).toBe("Bist du dabei?");
      expect(areYouComing(one)).toBe("Ist Anna dabei?");
      expect(areYouComing(two)).toBe("Sind Anna und Ben dabei?");
      expect(areYouComing({ self: true, others: ["Anna"] })).toBe("Seid du und Anna dabei?");
      expect(ifYouCannot(you)).toBe("Falls du nicht kannst, sag bitte ab.");
      expect(ifYouCannot(one)).toBe("Falls Anna nicht kann, sag bitte ab.");
      expect(areYouComing(youAnd)).toBe("Seid du, Anna und Ben dabei?");
    });
  });
});

describe("notifyPersons with a text per recipient", () => {
  let wd: number;
  let anna: number;
  let ben: number;
  let mia: number;
  let tom: number;
  let pushes: PushJob[];

  const account = async (personId: number) => (await one<{ id: number }>("SELECT id FROM accounts WHERE person_id = ?", personId)).id;
  const titlesFor = async (personId: number) => {
    const id = await account(personId);
    return pushes.filter((p) => p.accountIds.includes(id)).map((p) => p.payload.title);
  };

  beforeEach(async () => {
    await freshDb();
    await season();
    wd = await team("wD", "wD");
    anna = await person("Anna");
    ben = await person("Ben");
    // Mia plays herself and is the mother of Anna and Ben; Tom is their father
    mia = await person("Mia");
    tom = await person("Tom");
    for (const p of [anna, ben, mia]) await member(p, wd);
    for (const c of [anna, ben]) {
      await guardian(mia, c);
      await guardian(tom, c);
    }
    for (const p of [ben, mia, tom]) await loginAs(p);
    await exec("UPDATE accounts SET locale = 'en'");
    await exec("UPDATE accounts SET locale = 'de' WHERE person_id = ?", tom);
    await exec("INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || id, 'k', 'a' FROM accounts");
    pushes = [];
    vi.spyOn(env.PUSH_QUEUE, "sendBatch").mockImplementation(async (jobs) => {
      pushes.push(...[...jobs].map((j) => j.body as PushJob));
      return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as unknown as QueueSendBatchResponse;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the own account reads “you”, parents the children's names, in their language; one push per account", async () => {
    const sent = await notifyPersons(env, [anna, ben, mia], "squad", (who) => ({ title: areYouComing(who), body: ifYouCannot(who), url: "/" }), { teamIds: [wd] });
    expect(sent).toBe(3);
    expect(await titlesFor(ben)).toEqual(["Are you coming?"]);
    expect(await titlesFor(mia)).toEqual(["Are you, Anna, and Ben coming?"]);
    expect(await titlesFor(tom)).toEqual(["Sind Anna und Ben dabei?"]);
  });

  it("the same text for several accounts goes out together", async () => {
    await notifyPersons(env, [anna], "squad", (who) => ({ title: areYouComing(who), body: "", url: "/" }), { teamIds: [wd] });
    // Mia and Tom both read about Anna, in their own language
    expect(await titlesFor(mia)).toEqual(["Is Anna coming?"]);
    expect(await titlesFor(tom)).toEqual(["Ist Anna dabei?"]);
    expect(pushes).toHaveLength(2);
  });

  it("nominating children: the parents get the children's names", async () => {
    const coach = await person("Clara");
    await member(coach, wd, "coach");
    const coachCookie = await loginAs(coach);
    const game = await eventIn(wd, 3, { kind: "game", title: "TV Beispiel" });
    const res = await api(`/events/${game}/squad`, { method: "PUT", cookie: coachCookie, body: { personIds: [anna, ben] } });
    expect(res.status).toBe(200);
    expect(await titlesFor(mia)).toEqual(["Anna and Ben have been nominated"]);
    expect(await titlesFor(tom)).toEqual(["Anna und Ben sind nominiert"]);
    expect(await titlesFor(ben)).toEqual(["You have been nominated"]);
  });
});
