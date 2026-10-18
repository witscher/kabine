import { DurableObject } from "cloudflare:workers";

// Live updates of the helper plan: one object per team. Stores nothing, only
// broadcasts "something changed"; the clients then reload through the normal
// API. The worker checks permissions before /connect.

export class DutyHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "hello" }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/notify" && request.method === "POST") {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(JSON.stringify({ type: "changed" }));
        } catch {
          // Connection already closed
        }
      }
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }
}

/** In the EU like the chat rooms; locally (workerd) without jurisdiction. */
export function dutyHubStub(env: Env, teamId: number) {
  const name = `duties:${teamId}`;
  try {
    const eu = env.DUTY_HUB.jurisdiction("eu");
    return eu.get(eu.idFromName(name));
  } catch (err) {
    if (!(err instanceof Error && /not implemented in workerd/i.test(err.message))) throw err;
    return env.DUTY_HUB.get(env.DUTY_HUB.idFromName(name));
  }
}

/** Tell everyone who has the team's helper plan open to reload. */
export async function notifyDutyChange(env: Env, teamId: number): Promise<void> {
  try {
    await dutyHubStub(env, teamId).fetch("https://duties.internal/notify", { method: "POST" });
  } catch (err) {
    console.warn("Helper plan live", err);
  }
}
