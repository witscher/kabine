// Bridge from the worker to the chat Durable Objects (one per team).

/**
 * Chat rooms live in the EU (messages from minors, GDPR).
 * Locally (workerd/Miniflare) there are no jurisdictions, so it works
 * without one there. This error does not occur in production.
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
    if (!res.ok) console.warn(`Chat ${path} for team ${teamId}: ${res.status}`);
  } catch (err) {
    console.warn(`Chat ${path} for team ${teamId} failed`, err);
  }
}

/** System message in the team chat, e.g. when an event is cancelled. */
export async function postSystemMessage(env: Env, teamIds: number[], text: string): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/system", { text })));
}

/** Announcement by an admin to several chats. notify: notify everyone at once, as with @all. */
export async function postAnnouncement(env: Env, teamIds: number[], author: { personId: number; name: string }, text: string, notify: boolean): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/announce", { ...author, text, notify })));
}

/** A message of a person in one chat; only the public demo fills its chats this way. */
export async function postChatMessage(env: Env, teamId: number, author: { personId: number; name: string }, text: string): Promise<void> {
  await callRoom(env, teamId, "/post", { ...author, text });
}

export async function markFormerInChats(env: Env, teamIds: number[], personId: number): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/former", { personId })));
}

/** Anonymise deleted persons in the chats (messages stay, reactions go). */
export async function forgetInChats(env: Env, teamIds: number[], personIds: number[]): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/forget", { personIds })));
}

export async function setMuteInChat(env: Env, teamId: number, personId: number, muted: boolean): Promise<void> {
  await callRoom(env, teamId, "/mute", { personId, muted });
}

/** Disconnects parents who are only in the chat through their child (team without parents). */
export async function closeParentConnections(env: Env, teamId: number): Promise<void> {
  await callRoom(env, teamId, "/parents-off", {});
}

/** Disconnects these players from a team chat, so they reconnect with the limits of age class and team. */
export async function closeChildConnections(env: Env, teamId: number, personIds: number[]): Promise<void> {
  if (personIds.length) await callRoom(env, teamId, "/children-off", { personIds });
}

export async function clearChats(env: Env, teamIds: number[]): Promise<void> {
  await Promise.all(teamIds.map((teamId) => callRoom(env, teamId, "/clear", {})));
}
