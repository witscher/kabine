// Builds an e-mail as RFC 5322/MIME text for sending over SMTP: UTF-8 text body (base64), optional
// attachments (multipart/mixed). Header words with non-ASCII characters use RFC 2047 encoding.

export interface MimeMessage {
  from: { email: string; name?: string };
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: { content: ArrayBuffer | Uint8Array; filename: string; type: string }[];
  /** Fixed values for tests. */
  date?: Date;
  messageId?: string;
  boundary?: string;
}

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 in lines of 76 characters. */
function base64Lines(bytes: Uint8Array): string {
  return (base64(bytes).match(/.{1,76}/g) ?? []).join("\r\n");
}

/** RFC 2047 encoded word if needed. */
export function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64(encoder.encode(value))}?=`;
}

function address(a: { email: string; name?: string }): string {
  if (!a.name) return `<${a.email}>`;
  const name = /^[\w .-]*$/.test(a.name) ? `"${a.name}"` : encodeHeaderWord(a.name);
  return `${name} <${a.email}>`;
}

function assertHeaderSafe(value: string): void {
  if (/[\r\n]/.test(value)) throw new Error("Line break in a mail header");
}

export function buildMime(msg: MimeMessage): string {
  for (const v of [msg.to, msg.subject, msg.from.email, msg.from.name ?? "", msg.replyTo ?? ""]) assertHeaderSafe(v);
  const domain = msg.from.email.split("@")[1] ?? "localhost";
  const id = msg.messageId ?? `${crypto.randomUUID()}@${domain}`;
  const headers = [
    `From: ${address(msg.from)}`,
    `To: <${msg.to}>`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${(msg.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}>`,
    ...(msg.replyTo ? [`Reply-To: <${msg.replyTo}>`] : []),
    "MIME-Version: 1.0",
  ];
  const textPart = ['Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", base64Lines(encoder.encode(msg.text))].join("\r\n");
  if (!msg.attachments?.length) return [...headers, textPart].join("\r\n") + "\r\n";

  const boundary = msg.boundary ?? `kabine-${crypto.randomUUID()}`;
  const parts = [
    textPart,
    ...msg.attachments.map((a) => {
      assertHeaderSafe(a.filename);
      assertHeaderSafe(a.type);
      const bytes = a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content);
      const name = encodeHeaderWord(a.filename).replaceAll('"', "");
      return [
        `Content-Type: ${a.type}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(bytes),
      ].join("\r\n");
    }),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** SMTP transparency: lines starting with a dot get a second dot (RFC 5321 4.5.2). */
export function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, "$1..");
}
