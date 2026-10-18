// Brücke vom Worker zu den Chat-Durable-Objects (eines pro Mannschaft).

/**
 * Chaträume liegen in der EU (Nachrichten von Minderjährigen, DSGVO).
 * Lokal (workerd/Miniflare) gibt es keine Jurisdiktionen, dort wird ohne
 * gearbeitet. In Produktion tritt dieser Fehler nicht auf.
 */
export function chatStub(env: Env, teamId: number) {
  const name = `team:${teamId}`;
  try {
    const eu = env.CHAT.jurisdiction("eu");
    return eu.get(eu.idFromName(name));
  } catch (err) {
    if (!(err instanceof Error && /not implemented in workerd/i.test(err.message))) throw err;
    return env.CHAT.get(env.CHAT.idFromName(name));
  }
}

async function callRoom(env: Env, teamId: number, path: string, body: unknown): Promise<void> {
  try {
    const res = await chatStub(env, teamId).fetch(`https://chat.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-team-id": String(teamId) },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`Chat ${path} für Mannschaft ${teamId}: ${res.status}`);
  } catch (err) {
    console.warn(`Chat ${path} für Mannschaft ${teamId} fehlgeschlagen`, err);
  }
}

/** Systemmeldung im Mannschaftschat, z. B. bei einer Terminabsage. */
export async function postSystemMessage(env: Env, teamIds: number[], text: string): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/system", { text })));
}

/** Rundnachricht eines Admins in mehrere Chats. notify: sofort alle benachrichtigen wie bei @alle. */
export async function postAnnouncement(env: Env, teamIds: number[], author: { personId: number; name: string }, text: string, notify: boolean): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/announce", { ...author, text, notify })));
}

export async function markFormerInChats(env: Env, teamIds: number[], personId: number): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/former", { personId })));
}

/** Gelöschte Personen in den Chats anonymisieren (Nachrichten bleiben, Reaktionen gehen). */
export async function forgetInChats(env: Env, teamIds: number[], personIds: number[]): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/forget", { personIds })));
}

export async function setMuteInChat(env: Env, teamId: number, personId: number, muted: boolean): Promise<void> {
  await callRoom(env, teamId, "/mute", { personId, muted });
}

/** Trennt Eltern, die nur über ihr Kind im Chat sind (Mannschaft ohne Eltern). */
export async function closeParentConnections(env: Env, teamId: number): Promise<void> {
  await callRoom(env, teamId, "/parents-off", {});
}

export async function clearChats(env: Env, teamIds: number[]): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/clear", {})));
}
