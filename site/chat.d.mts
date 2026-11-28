// Types for site/chat.mjs (used by test/site-chat.test.ts).
import type { Docs } from "./chat-core.mjs";
export interface ChatStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}
export interface ChatReply { reply: string; route: string; steps: { step: string; ms: number }[] }
export declare function handleChat(request: Request, env: unknown): Promise<Response>;
export declare function loadDocs(env: unknown): Promise<Docs>;
export declare function handleMessage(input: {
  storage: ChatStorage;
  env: unknown;
  budget: { take(kind: "triage" | "answer"): Promise<boolean> | boolean };
  message: string;
  lang: "de" | "en";
  now?: number;
}): Promise<ChatReply>;
export declare function takeBudget(storage: ChatStorage, kind: "triage" | "answer", now?: number): Promise<boolean>;
export declare class KabineChatVisitor {
  send(input: { message: string; lang: "de" | "en" }): Promise<ChatReply>;
  history(): Promise<{ role: string; text: string; route?: string }[]>;
  forget(): Promise<void>;
  alarm(): Promise<void>;
}
export declare class KabineChatBudget {
  take(kind: "triage" | "answer"): Promise<boolean>;
}
