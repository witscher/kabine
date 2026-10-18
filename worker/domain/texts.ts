// Text messages (SMS) for sign-in codes and reminders, sent through the module that provides them
// (WorkerModule.texts, today modules/sms). Without such a module switched on, nothing is sent.
import { activeWorkerModules } from "../modules";

export class TextsNotConfigured extends Error {}

function provider() {
  return activeWorkerModules().find((m) => m.texts)?.texts ?? null;
}

/** A module for text messages is switched on (people may enter a phone number). */
export function textsOn(): boolean {
  return provider() != null;
}

/** Switched on and set up, so messages can go out. */
export async function textsAvailable(db: D1Database): Promise<boolean> {
  const p = provider();
  return !!p && (await p.available(db));
}

export async function sendText(env: Env, to: string, text: string): Promise<void> {
  const p = provider();
  if (!p) throw new TextsNotConfigured("No module for text messages is on.");
  await p.send(env, to, text);
}
