// Types for site/chat-core.mjs (used by test/site-chat.test.ts).
export interface Section { id: string; lang: string; title: string; url: string; text: string }
export interface Docs { sections: Section[]; german?: Record<string, string> }
export interface Turn { role: "user" | "assistant"; text: string; at?: number; route?: string; blocked?: boolean }
export interface Scores { intent: Record<string, number>; manipulation: number; personalData: number }
export type Route = "personal_data" | "blocked" | "off_topic" | "greeting" | "thanks" | "answer" | "unsure";
export declare const MODELS: { triage: string; sections: string; answer: string };
export declare const LIMITS: {
  messageChars: number; perMinute: number; perDay: number; history: number; keepMs: number;
  globalPerMinute: number; globalTriagePerDay: number; globalAnswersPerDay: number;
};
export declare const THRESHOLDS: { personalData: number; manipulation: number; offTopic: number; greeting: number; unsure: number };
export declare const LINK_HOSTS: string[];
export declare const OFF_TOPIC: string;
export declare const VISITOR_ID: RegExp;
export declare const FIXED: Record<"de" | "en", Record<string, string>>;
export declare function triageInput(message: string, history: Turn[]): { model: string; state: unknown; questions: Record<string, unknown> };
export declare function readTriage(result: unknown): Scores;
export declare function hasObviousPersonalData(text: string): boolean;
export declare function sectionsInput(message: string, history: Turn[], docs: Docs): { model: string; state: unknown; questions: Record<string, unknown> };
export declare function readSections(result: unknown): [string, number][];
export declare function decideRoute(scores: Scores, thresholds?: typeof THRESHOLDS): Route;
export declare function pickSections(ranked: [string, number][], docs: Docs): Section[];
export declare function contextTurns(history: Turn[], turns: number): Turn[];
export declare function answerMessages(input: { message: string; history: Turn[]; sections: Section[]; docs: Docs; lang: string; route: string; scores: Scores }): { role: string; content: string }[];
export declare function knownUrls(docs: Docs): Set<string>;
export declare function cleanAnswer(text: unknown, docs: Docs, lang: string): string | null;
export declare function cleanMessage(value: unknown): string;
export declare function slidingWindow(times: number[], now: number, windows: { ms: number; max: number }[]): { ok: boolean; keep: number[] };
