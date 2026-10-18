// Minimal SMTP client over Cloudflare TCP sockets, for clubs that send mail through their own mail
// server. Supports implicit TLS (port 465) and STARTTLS (port 587), AUTH PLAIN and LOGIN.
// Plain-text connections are refused: the password and the mails must not travel unencrypted.
import { connect } from "cloudflare:sockets";
import { buildMime, dotStuff, type MimeMessage } from "./mime";

export interface SmtpConfig {
  host: string;
  port: number;
  /** "tls": encrypted from the start (465). "starttls": upgrade after EHLO (587, 25). */
  security: "tls" | "starttls";
  user: string;
  password: string;
}

/** A connection as the client sees it; tests replace it with a scripted server. */
export interface SmtpConnection {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
  startTls(): SmtpConnection;
  close(): Promise<void>;
}

export type Dialer = (config: SmtpConfig) => SmtpConnection;

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const TIMEOUT_MS = 15_000;

function wrapSocket(socket: Socket): SmtpConnection {
  const reader = socket.readable.pipeThrough(new TextDecoderStream()).getReader();
  const writer = socket.writable.getWriter();
  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    },
    async write(data) {
      await writer.write(encoder.encode(data));
    },
    startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return wrapSocket(socket.startTls());
    },
    async close() {
      await socket.close().catch(() => undefined);
    },
  };
}

export const dialSocket: Dialer = (config) =>
  wrapSocket(connect({ hostname: config.host, port: config.port }, { secureTransport: config.security === "tls" ? "on" : "starttls", allowHalfOpen: false }));

/** Reads one (possibly multi-line) SMTP reply. */
class ReplyReader {
  private buffer = "";
  constructor(private conn: SmtpConnection) {}

  setConnection(conn: SmtpConnection) {
    this.conn = conn;
    this.buffer = "";
  }

  async reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const nl = this.buffer.indexOf("\r\n");
      if (nl < 0) {
        const chunk = await withTimeout(this.conn.read());
        if (chunk == null) throw new SmtpError("The mail server closed the connection.");
        this.buffer += chunk;
        continue;
      }
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 2);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) {
        const code = Number(line.slice(0, 3));
        if (!Number.isInteger(code)) throw new SmtpError(`Unexpected reply: ${line.slice(0, 100)}`);
        return { code, text: lines.map((l) => l.slice(4)).join("\n") };
      }
    }
  }
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new SmtpError("The mail server does not answer.")), TIMEOUT_MS))]);
}

function b64(s: string): string {
  let bin = "";
  for (const byte of encoder.encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Sends one message. Throws SmtpError with the server's reply on failure. */
export async function smtpSend(config: SmtpConfig, message: MimeMessage, dial: Dialer = dialSocket): Promise<void> {
  let conn = dial(config);
  const replies = new ReplyReader(conn);
  const expect = async (ok: (code: number) => boolean, what: string) => {
    const r = await replies.reply();
    if (!ok(r.code)) throw new SmtpError(`${what}: ${r.code} ${r.text.slice(0, 200)}`, r.code);
    return r;
  };
  const command = async (line: string, ok: (code: number) => boolean, what: string) => {
    await conn.write(`${line}\r\n`);
    return expect(ok, what);
  };
  const is2xx = (c: number) => c >= 200 && c < 300;
  const helo = new URL(`https://${message.from.email.split("@")[1] ?? "localhost"}`).hostname;
  try {
    await expect(is2xx, "Greeting");
    let ehlo = await command(`EHLO ${helo}`, is2xx, "EHLO");
    if (config.security === "starttls") {
      if (!/^STARTTLS$/im.test(ehlo.text)) throw new SmtpError("The mail server does not offer STARTTLS.");
      await command("STARTTLS", is2xx, "STARTTLS");
      conn = conn.startTls();
      replies.setConnection(conn);
      ehlo = await command(`EHLO ${helo}`, is2xx, "EHLO");
    }
    const auth = /^AUTH[ =](.*)$/im.exec(ehlo.text)?.[1]?.toUpperCase().split(/\s+/) ?? [];
    if (auth.includes("PLAIN")) {
      await command(`AUTH PLAIN ${b64(`\0${config.user}\0${config.password}`)}`, (c) => c === 235, "Login");
    } else if (auth.includes("LOGIN")) {
      await command("AUTH LOGIN", (c) => c === 334, "Login");
      await command(b64(config.user), (c) => c === 334, "Login");
      await command(b64(config.password), (c) => c === 235, "Login");
    } else {
      throw new SmtpError("The mail server offers no supported login (PLAIN or LOGIN).");
    }
    await command(`MAIL FROM:<${message.from.email}>`, is2xx, "Sender");
    await command(`RCPT TO:<${message.to}>`, is2xx, "Recipient");
    await command("DATA", (c) => c === 354, "DATA");
    const data = dotStuff(buildMime(message));
    await conn.write(data.endsWith("\r\n") ? `${data}.\r\n` : `${data}\r\n.\r\n`);
    await expect(is2xx, "Message");
    await conn.write("QUIT\r\n").catch(() => undefined);
  } finally {
    await conn.close();
  }
}
