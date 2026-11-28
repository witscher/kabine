// Types for site/src/chat-docs.mjs (used by test/site-chat.test.ts).
import type { Docs, Section } from "../chat-core.mjs";
export declare function htmlToText(html: string): string;
export declare function pageSections(path: string, html: string, base?: string): Section[];
export declare function chatDocs(pages: { path: string; html: string }[], modules?: { id: string; markdown: string }[]): Docs;
