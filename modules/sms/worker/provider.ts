// SMS module: provider adapter. First provider seven.io (German company, servers in the EU).
// Only used when the club switches the module on and enters an API key; phone numbers are stored
// only for people who enter one themselves.

export interface SmsConfig {
  provider: "seven";
  apiKey: string;
  /** Sender name shown on the phone (max. 11 characters, letters and digits). */
  sender: string;
}

export class SmsError extends Error {}

/** International format +49…; returns null if it is not a plausible mobile number. */
export function normalizePhone(input: string, defaultCountryCode = "49"): string | null {
  let s = input.replace(/[\s()/.-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+${defaultCountryCode}${s.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

export function validSender(sender: string): boolean {
  return /^[A-Za-z0-9 ]{1,11}$/.test(sender) || /^\+?\d{3,16}$/.test(sender);
}

export async function sendSms(config: SmsConfig, to: string, text: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (config.provider !== "seven") throw new SmsError("Unknown SMS provider");
  const res = await fetcher("https://gateway.seven.io/api/sms", {
    method: "POST",
    headers: { "X-Api-Key": config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to, text, from: config.sender }),
  });
  if (!res.ok) throw new SmsError(`SMS provider answered ${res.status}`);
  // seven.io answers 200 with its own code: 100 = sent
  const body = (await res.json().catch(() => null)) as { success?: string } | null;
  if (body && body.success !== undefined && String(body.success) !== "100") throw new SmsError(`SMS not sent (code ${body.success})`);
}
