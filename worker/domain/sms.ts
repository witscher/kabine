// SMS module: provider settings (API key stored encrypted) and sending. Phone numbers are stored only
// for people who enter one themselves, and only while the module is on.
import { isModuleOn } from "./club";
import { first, run } from "../lib/db";
import { open, seal } from "../lib/secret-box";
import { type SmsConfig, sendSms } from "../lib/sms";

export interface SmsSettings {
  provider: "seven";
  apiKeySealed: string | null;
  sender: string;
}

const KEY = "sms";

export async function loadSmsSettings(db: D1Database): Promise<SmsSettings> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", KEY);
  return row ? (JSON.parse(row.value) as SmsSettings) : { provider: "seven", apiKeySealed: null, sender: "Kabine" };
}

export async function saveSmsSettings(env: Pick<Env, "DB" | "APP_SECRET">, input: { sender: string; apiKey?: string }): Promise<SmsSettings> {
  const previous = await loadSmsSettings(env.DB);
  const next: SmsSettings = {
    provider: "seven",
    sender: input.sender,
    apiKeySealed: input.apiKey ? await seal(env.APP_SECRET, input.apiKey) : previous.apiKeySealed,
  };
  await run(env.DB, "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", KEY, JSON.stringify(next));
  return next;
}

export class SmsNotConfigured extends Error {}

/** Replaceable in tests. */
export const smsTransport = { send: sendSms };

export async function smsAvailable(db: D1Database): Promise<boolean> {
  return isModuleOn("sms") && !!(await loadSmsSettings(db)).apiKeySealed;
}

export async function sendSmsTo(env: Env, to: string, text: string): Promise<void> {
  if (!isModuleOn("sms")) throw new SmsNotConfigured("The SMS module is off.");
  const settings = await loadSmsSettings(env.DB);
  if (!settings.apiKeySealed) throw new SmsNotConfigured("No SMS provider set up.");
  const config: SmsConfig = { provider: settings.provider, apiKey: await open(env.APP_SECRET, settings.apiKeySealed), sender: settings.sender };
  await smsTransport.send(config, to, text.slice(0, 450));
}
