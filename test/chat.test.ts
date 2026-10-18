import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, eventIn, exec, freshDb, guardian, loginAs, member, person, rows, season, team } from "./helpers";

async function connect(teamId: number, cookie: string) {
  const res = await exports.default.fetch(
    new Request(`http://localhost:5173/api/chat/${teamId}/connect`, { headers: { upgrade: "websocket", cookie, origin: "http://localhost:5173" } }),
  );
  if (res.status !== 101) return { status: res.status, body: await res.json() };
  const ws = res.webSocket!;
  ws.accept();
  const messages: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const data = JSON.parse(e.data as string);
    messages.push(data);
    waiters.splice(0).forEach((w) => w(data));
  });
  const next = (type: string) =>
    new Promise<any>((resolve) => {
      const found = messages.find((m) => m.type === type && !m.seen);
      if (found) {
        found.seen = true;
        return resolve(found);
      }
      const check = (m: any) => {
        if (m.type === type) {
          m.seen = true;
          resolve(m);
        } else waiters.push(check);
      };
      waiters.push(check);
    });
  return { status: 101, ws, messages, next };
}

let wd: number;
let coach: number;
let alma: number;
let kid: number;
let mum: number;

beforeEach(async () => {
  await freshDb();
  await season();
  wd = await team("wD", "wD");
  coach = await person("Coachy");
  alma = await person("Alma");
  kid = await person("Kira");
  mum = await person("Mona");
  await member(coach, wd, "coach");
  await member(alma, wd);
  await member(kid, wd);
  await guardian(mum, kid);
});

describe("Mannschaftschat", () => {
  it("in Gruppen lassen sich alle Mitglieder erwähnen, auch ohne eigene Nachricht", async () => {
    const admin = await person("Ada", { admin: true });
    const res = await api("/groups", { cookie: await loginAs(admin), body: { name: "Trainerteam" } });
    const group = res.body.id as number;
    await member(coach, group, "coach");
    await member(alma, group);
    await member(kid, group);
    const c = (await connect(group, await loginAs(coach))) as any;
    const hello = await c.next("hello");
    const names = hello.mentionable.map((m: any) => m.personId).sort();
    expect(names).toEqual([alma, coach, kid].sort());
    c.ws.close();
    // In der Mannschaft bleibt es bei Trainern und Personen, die geschrieben haben
    const t = (await connect(wd, await loginAs(coach))) as any;
    expect((await t.next("hello")).mentionable.map((m: any) => m.personId)).toEqual([coach]);
    t.ws.close();
  });

  it("Absage und Zurücknahme eines Trainings erscheinen als Hinweis im Chat", async () => {
    const ev = await eventIn(wd, 3);
    const coachCookie = await loginAs(coach);
    const a = (await connect(wd, await loginAs(alma))) as any;
    await a.next("hello");
    expect((await api(`/events/${ev}/cancel`, { cookie: coachCookie, body: { reason: "Halle belegt" } })).status).toBe(200);
    expect((await a.next("message")).message.text).toMatch(/^Coachy hat das Training am .+ abgesagt\.$/);
    expect((await api(`/events/${ev}/uncancel`, { cookie: coachCookie, body: {} })).status).toBe(200);
    expect((await a.next("message")).message.text).toMatch(/^Coachy hat die Absage zurückgenommen: Das Training am .+ findet doch statt\.$/);
    a.ws.close();
  });

  it("verteilt Nachrichten in Echtzeit mit Rolle und Elternhinweis", async () => {
    const c = (await connect(wd, await loginAs(coach))) as any;
    const a = (await connect(wd, await loginAs(alma))) as any;
    const m = (await connect(wd, await loginAs(mum))) as any;
    await c.next("hello");
    expect((await a.next("hello")).me).toMatchObject({ canWrite: true, isMod: false });
    await m.next("hello");

    c.ws.send(JSON.stringify({ type: "send", text: "Training fällt aus", clientId: "x" }));
    const got = await a.next("message");
    expect(got.message).toMatchObject({ text: "Training fällt aus", authorName: "Coachy M.", authorLabel: "Coach" });
    m.ws.send(JSON.stringify({ type: "send", text: "Danke!" }));
    const fromMum = await a.next("message");
    expect(fromMum.message).toMatchObject({ authorName: "Mona M.", authorLabel: "Elternteil von Kira" });

    // Moderation: nur Trainer dürfen löschen
    a.ws.send(JSON.stringify({ type: "delete", id: got.message.id }));
    c.ws.send(JSON.stringify({ type: "delete", id: fromMum.message.id }));
    const deleted = await a.next("deleted");
    expect(deleted.id).toBe(fromMum.message.id);
    for (const s of [c, a, m]) s.ws.close();
  });

  it("Elternfreigaben gelten serverseitig für den Chat", async () => {
    await exec("INSERT INTO child_permissions (child_id, may_read_chat, may_write_chat) VALUES (?, 1, 0)", kid);
    const k = (await connect(wd, await loginAs(kid))) as any;
    const hello = await k.next("hello");
    expect(hello.me.canWrite).toBe(false);
    k.ws.send(JSON.stringify({ type: "send", text: "Hallo" }));
    expect((await k.next("error")).message).toContain("nur lesen");
    k.ws.close();

    await exec("UPDATE child_permissions SET may_read_chat = 0 WHERE child_id = ?", kid);
    const blocked = await connect(wd, await loginAs(kid));
    expect(blocked.status).toBe(403);
  });

  it("Eltern können sich abmelden, Fremde haben keinen Zugriff", async () => {
    const mumCookie = await loginAs(mum);
    expect((await api(`/chat/${wd}/optout`, { method: "PUT", cookie: mumCookie, body: { optedOut: true } })).status).toBe(200);
    expect((await connect(wd, mumCookie)).status).toBe(403);
    const rooms = await api("/chat/rooms", { cookie: mumCookie });
    expect(rooms.body.rooms[0]).toMatchObject({ canRead: false, optedOut: true });
    const stranger = await person("Fremd");
    expect((await connect(wd, await loginAs(stranger))).status).toBe(403);
    // Spieler können sich nicht abmelden
    expect((await api(`/chat/${wd}/optout`, { method: "PUT", cookie: await loginAs(alma), body: { optedOut: true } })).status).toBe(403);
  });

  it("ehemalige Mitglieder erscheinen pseudonymisiert, Trainer sehen den Namen", async () => {
    const a = (await connect(wd, await loginAs(alma))) as any;
    await a.next("hello");
    a.ws.send(JSON.stringify({ type: "send", text: "Tschüss" }));
    await a.next("message");
    a.ws.close();
    await api(`/persons/${alma}/leave`, { cookie: await loginAs(coach), body: {} });
    await new Promise((r) => setTimeout(r, 50));
    const k = (await connect(wd, await loginAs(kid))) as any;
    const forKid = (await k.next("hello")).messages[0];
    expect(forKid).toMatchObject({ authorName: "Ehemalige/r Spieler/in", isFormer: true, authorId: null });
    const c = (await connect(wd, await loginAs(coach))) as any;
    expect((await c.next("hello")).messages[0]).toMatchObject({ authorName: "Alma M.", isFormer: true });
    k.ws.close();
    c.ws.close();
  });
});

describe("Erwähnungen und Zahl am App-Icon", () => {
  it("erwähnt nur Personen aus dem Chat, zählt bis zum Lesen und offene Anfragen", async () => {
    const coachCookie = await loginAs(coach);
    const almaCookie = await loginAs(alma);
    const kidCookie = await loginAs(kid);
    const mumCookie = await loginAs(mum);
    const c = (await connect(wd, coachCookie)) as any;
    const hello = await c.next("hello");
    // Noch hat niemand außer dem Trainer geschrieben
    expect(hello.mentionable.map((m: any) => m.personId)).toEqual([coach]);

    const a = (await connect(wd, almaCookie)) as any;
    await a.next("hello");
    a.ws.send(JSON.stringify({ type: "send", text: "Hallo zusammen" }));
    await c.next("message");
    await a.next("message"); // die eigene Nachricht kommt auch zurück

    // Kira hat nie geschrieben und ist nicht erwähnbar, sich selbst erwähnt man nicht
    c.ws.send(JSON.stringify({ type: "send", text: "@Alma M. @Kira M. bitte Bälle mitbringen", mentions: [alma, kid, coach] }));
    const msg = (await a.next("message")).message;
    expect(msg.mentions).toEqual([alma]);

    expect((await api("/badge", { cookie: almaCookie })).body).toMatchObject({ count: 1, mentions: 1, requests: 0 });
    expect((await api("/badge", { cookie: kidCookie })).body.count).toBe(0);

    // Gelesen: Zahl geht weg
    a.ws.send(JSON.stringify({ type: "read", id: msg.id }));
    await expect.poll(async () => (await api("/badge", { cookie: almaCookie })).body.count).toBe(0);

    // Offene Aushilfe-Anfrage für Kira zählt bei Kira und bei ihrer Mutter
    const wc = await team("wC", "wC");
    const wcCoach = await person("Coach C");
    await member(wcCoach, wc, "coach");
    const { eventIn } = await import("./helpers");
    const game = await eventIn(wc, 6, { kind: "game" });
    expect((await api(`/events/${game}/help-requests`, { cookie: await loginAs(wcCoach), body: { personId: kid } })).status).toBe(201);
    expect((await api("/badge", { cookie: kidCookie })).body).toMatchObject({ count: 1, requests: 1 });
    expect((await api("/badge", { cookie: mumCookie })).body).toMatchObject({ count: 1, requests: 1 });

    // Gelöschte Nachricht zählt nicht mehr
    c.ws.send(JSON.stringify({ type: "send", text: "@Alma M. noch was", mentions: [alma] }));
    const second = (await a.next("message")).message;
    expect((await api("/badge", { cookie: almaCookie })).body.mentions).toBe(1);
    c.ws.send(JSON.stringify({ type: "delete", id: second.id }));
    await a.next("deleted");
    await expect.poll(async () => (await api("/badge", { cookie: almaCookie })).body.mentions).toBe(0);
    for (const s of [c, a]) s.ws.close();
  });
});

describe("@alle", () => {
  it("nur Trainer und Admins, zählt bei allen im Chat außer dem Absender", async () => {
    const coachCookie = await loginAs(coach);
    const almaCookie = await loginAs(alma);
    const kidCookie = await loginAs(kid);
    const mumCookie = await loginAs(mum);
    const c = (await connect(wd, coachCookie)) as any;
    const a = (await connect(wd, almaCookie)) as any;
    await c.next("hello");
    await a.next("hello");

    // Spielerin: @alle wird ignoriert
    a.ws.send(JSON.stringify({ type: "send", text: "@alle hallo", mentionAll: true }));
    expect((await c.next("message")).message).toMatchObject({ mentionAll: false, mentions: [] });
    await a.next("message");
    expect((await api("/badge", { cookie: kidCookie })).body.mentions).toBe(0);

    // Trainer: @alle erreicht Spielerinnen und über das Kind die Mutter
    c.ws.send(JSON.stringify({ type: "send", text: "@alle Treffpunkt 9 Uhr", mentionAll: true }));
    expect((await a.next("message")).message).toMatchObject({ mentionAll: true });
    for (const cookie of [almaCookie, kidCookie, mumCookie]) expect((await api("/badge", { cookie })).body.mentions).toBe(1);
    expect((await api("/badge", { cookie: coachCookie })).body.mentions).toBe(0);

    // Kind ohne Lesefreigabe im Chat: nichts zählt, die Mutter liest für das Kind mit
    await exec("INSERT INTO child_permissions (child_id, may_read_chat) VALUES (?, 0)", kid);
    c.ws.send(JSON.stringify({ type: "send", text: "@alle noch was", mentionAll: true }));
    await a.next("message");
    expect((await api("/badge", { cookie: kidCookie })).body.mentions).toBe(0);
    expect((await api("/badge", { cookie: mumCookie })).body.mentions).toBe(2);
    expect((await api("/badge", { cookie: almaCookie })).body.mentions).toBe(2);
    for (const s of [c, a]) s.ws.close();
  });
});

describe("Reaktionen", () => {
  it("eine pro Person, nicht auf eigene Nachrichten, mit Namen beim Antippen", async () => {
    const c = (await connect(wd, await loginAs(coach))) as any;
    const a = (await connect(wd, await loginAs(alma))) as any;
    await c.next("hello");
    await a.next("hello");
    c.ws.send(JSON.stringify({ type: "send", text: "Training um 17 Uhr" }));
    const { message } = await a.next("message");
    await c.next("message");

    // Eigene Nachricht: ignoriert
    c.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "👍" }));
    // Nicht erlaubtes Emoji: ignoriert
    a.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "💩" }));
    a.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "👍" }));
    const first = await c.next("reactions");
    expect(first).toMatchObject({ id: message.id, reactions: [{ emoji: "👍", names: ["Alma M."], mine: false }] });
    expect((await a.next("reactions")).reactions[0].mine).toBe(true);

    // Neue Reaktion ersetzt die alte, null nimmt sie zurück
    a.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "❤️" }));
    expect((await c.next("reactions")).reactions).toEqual([{ emoji: "❤️", names: ["Alma M."], mine: false }]);
    a.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "😂" }));
    await c.next("reactions");

    // Beim nächsten Verbinden sind die Reaktionen dabei
    const again = (await connect(wd, await loginAs(coach))) as any;
    const hello = await again.next("hello");
    expect(hello.messages.find((m: any) => m.id === message.id).reactions).toEqual([{ emoji: "😂", names: ["Alma M."], mine: false }]);

    a.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: null }));
    expect((await c.next("reactions")).reactions).toEqual([]);
    // Die Reaktion der Coach-Verbindung auf die eigene Nachricht kam nie an
    expect(c.messages.filter((m: any) => m.type === "reactions")).toHaveLength(4);
    for (const s of [c, a, again]) s.ws.close();
  });

  it("nur wer schreiben darf", async () => {
    await exec("INSERT INTO child_permissions (child_id, may_read_chat, may_write_chat) VALUES (?, 1, 0)", kid);
    const c = (await connect(wd, await loginAs(coach))) as any;
    await c.next("hello");
    c.ws.send(JSON.stringify({ type: "send", text: "Hallo" }));
    const { message } = await c.next("message");
    const k = (await connect(wd, await loginAs(kid))) as any;
    await k.next("hello");
    k.ws.send(JSON.stringify({ type: "react", id: message.id, emoji: "👋" }));
    expect((await k.next("error")).message).toContain("nur lesen");
    for (const s of [c, k]) s.ws.close();
  });
});

describe("Chatliste für Admins", () => {
  it("fremde Chats sind nur als adminOnly markiert und zählen nicht als ungelesen", async () => {
    const admin = await person("Ada", { admin: true });
    const other = await team("wC", "wC");
    await member(admin, wd, "coach");
    const cookie = await loginAs(admin);
    await exec("INSERT INTO chat_state (team_id, last_message_id, last_message_at) VALUES (?, 5, '2026-01-01T00:00:00Z')", other);
    const rooms = (await api("/chat/rooms", { cookie })).body.rooms;
    expect(rooms.map((r: any) => [r.teamName, r.adminOnly, r.unread])).toEqual([
      ["wC", true, false],
      ["wD", false, false],
    ]);
    // Lesen und moderieren dürfen Admins trotzdem
    const s = (await connect(other, cookie)) as any;
    expect((await s.next("hello")).me.isMod).toBe(true);
    s.ws.close();
  });
});

describe("Rundnachricht", () => {
  it("nur Admins, als Ankündigung in allen gewählten Chats, mit Push-Wahl", async () => {
    const admin = await person("Ada", { admin: true });
    const other = await team("wC", "wC");
    const adminCookie = await loginAs(admin);
    expect((await api("/admin/broadcast", { cookie: await loginAs(coach), body: { teamIds: [], text: "Hallo", notify: false } })).status).toBe(403);

    const a = (await connect(wd, await loginAs(alma))) as any;
    await a.next("hello");
    const res = await api("/admin/broadcast", { cookie: adminCookie, body: { teamIds: [], text: "Saisonabschluss am Samstag", notify: false } });
    expect(res.body).toEqual({ sent: 2 });
    const got = await a.next("message");
    expect(got.message).toMatchObject({ kind: "announcement", text: "Saisonabschluss am Samstag", authorName: "Ada M.", mentionAll: false });
    // Ohne Häkchen keine Erwähnung, also keine Zahl am App-Icon
    expect((await api("/badge", { cookie: await loginAs(alma) })).body.mentions).toBe(0);

    // Reagieren geht auch auf Ankündigungen
    a.ws.send(JSON.stringify({ type: "react", id: got.message.id, emoji: "👍" }));
    expect((await a.next("reactions")).reactions[0]).toMatchObject({ emoji: "👍", mine: true });

    // Mit Häkchen: wie @alle, nur in der gewählten Mannschaft
    await api("/admin/broadcast", { cookie: adminCookie, body: { teamIds: [wd], text: "Bitte alle lesen", notify: true } });
    const second = await a.next("message");
    expect(second.message).toMatchObject({ kind: "announcement", mentionAll: true });
    expect((await api("/badge", { cookie: await loginAs(alma) })).body.mentions).toBe(1);

    const o = (await connect(other, adminCookie)) as any;
    const hello = await o.next("hello");
    expect(hello.messages.map((m: any) => m.text)).toEqual(["Saisonabschluss am Samstag"]);
    expect((await api("/admin/broadcast", { cookie: adminCookie, body: { teamIds: [9999], text: "x", notify: false } })).status).toBe(400);
    for (const s of [a, o]) s.ws.close();
  });
});

describe("Person dauerhaft löschen", () => {
  it("nur Admins, Eltern ohne weiteres Kind gehen mit, im Chat bleibt die Nachricht anonym", async () => {
    const admin = await person("Ada", { admin: true });
    const adminCookie = await loginAs(admin);
    expect((await api(`/admin/persons/${kid}`, { method: "DELETE", cookie: await loginAs(coach) })).status).toBe(403);
    expect((await api(`/admin/persons/${admin}`, { method: "DELETE", cookie: adminCookie })).status).toBe(400);

    const c = (await connect(wd, await loginAs(coach))) as any;
    const k = (await connect(wd, await loginAs(kid))) as any;
    await c.next("hello");
    await k.next("hello");
    c.ws.send(JSON.stringify({ type: "send", text: "Training morgen" }));
    const fromCoach = (await k.next("message")).message;
    await c.next("message");
    k.ws.send(JSON.stringify({ type: "send", text: "Ich komme" }));
    await c.next("message");
    k.ws.send(JSON.stringify({ type: "react", id: fromCoach.id, emoji: "👍" }));
    expect((await c.next("reactions")).reactions).toHaveLength(1);
    k.ws.close();

    const res = await api(`/admin/persons/${kid}`, { method: "DELETE", cookie: adminCookie });
    expect(res.body).toEqual({ ok: true, parentsDeleted: 1 });
    expect(await rows("SELECT id FROM persons WHERE id IN (?, ?)", kid, mum)).toEqual([]);
    expect(await rows("SELECT * FROM accounts WHERE person_id = ?", kid)).toEqual([]);
    expect(await rows("SELECT * FROM team_memberships WHERE person_id = ?", kid)).toEqual([]);

    // Anonymisierung läuft im Hintergrund: die Reaktion verschwindet live
    expect((await c.next("reactions")).reactions).toEqual([]);
    const again = (await connect(wd, await loginAs(coach))) as any;
    const hello = await again.next("hello");
    const mine = hello.messages.find((m: any) => m.text === "Ich komme");
    expect(mine).toMatchObject({ authorName: "Gelöschte Person", authorId: null, authorLabel: null });
    // Nicht mehr per @ erwähnbar
    expect(hello.mentionable.some((m: any) => m.name === "Gelöschte Person")).toBe(false);
    for (const s of [c, again]) s.ws.close();
  });
});
