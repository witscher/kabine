import { DurableObject } from "cloudflare:workers";

// Live-Aktualisierung des Helferplans: ein Objekt pro Mannschaft. Speichert
// nichts, verteilt nur "es hat sich etwas geändert"; die Clients laden dann
// über die normale API neu. Der Worker prüft die Berechtigung vor /connect.

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
          // Verbindung bereits geschlossen
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
      // schon geschlossen
    }
  }
}

/** Wie die Chaträume in der EU; lokal (workerd) ohne Jurisdiktion. */
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

/** Allen, die den Helferplan der Mannschaft offen haben, "neu laden" melden. */
export async function notifyDutyChange(env: Env, teamId: number): Promise<void> {
  try {
    await dutyHubStub(env, teamId).fetch("https://duties.internal/notify", { method: "POST" });
  } catch (err) {
    console.warn("Helferplan live", err);
  }
}
