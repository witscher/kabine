// The chatbot of kabine.dev: POST /api/chat, /api/chat/history and /api/chat/delete. Each visitor has a
// Durable Object (KabineChatVisitor) with their last messages, their rate limit and an alarm that deletes
// everything 24 hours after the last message; one more object (KabineChatBudget) counts the model calls of
// the whole site per day. Every message passes the triage with Clef first; only questions about Kabine
// reach the language model (site/chat-core.mjs). Messages with personal data are refused and not stored.
// Nothing here logs: no message text, no visitor id, no error.
import { DurableObject } from "cloudflare:workers";
import * as core from "./chat-core.mjs";

const { LIMITS, FIXED, MODELS } = core;
const MAX_BODY = 4096;
const TIMEOUT_MS = { triage: 8000, sections: 8000, answer: 30000 };
/**
 * Every call goes through the account's default AI Gateway, without caching and without a log entry (the
 * gateway would otherwise store prompt and answer); the metadata only names the feature in its analytics.
 */
const GATEWAY = { gateway: { id: "default", skipCache: true, collectLog: false, metadata: { feature: "kabine-site-chat" } } };

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The three endpoints; the Worker in site/worker.mjs sends every /api/chat request here. */
export async function handleChat(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  // Only the website's own pages may use the chat (a browser on another site sends its own origin)
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
  if (!/^application\/json\b/.test(request.headers.get("Content-Type") ?? "")) return json({ error: "invalid" }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json({ error: "too_large" }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const id = typeof body?.id === "string" && core.VISITOR_ID.test(body.id) ? body.id : null;
  if (!id) return json({ error: "invalid" }, 400);
  const lang = body.lang === "de" ? "de" : "en";
  const visitor = env.CHAT_VISITOR.get(env.CHAT_VISITOR.idFromName(id));
  try {
    switch (url.pathname) {
      case "/api/chat": {
        const message = core.cleanMessage(body.message);
        if (!message) return json({ error: "invalid" }, 400);
        if (message.length > LIMITS.messageChars) return json({ error: "too_long", reply: FIXED[lang].too_long, route: "too_long" }, 413);
        return json(await visitor.send({ message, lang }));
      }
      case "/api/chat/history":
        return json({ turns: await visitor.history() });
      case "/api/chat/delete":
        await visitor.forget();
        return json({ deleted: true });
      default:
        return json({ error: "not_found" }, 404);
    }
  } catch {
    // Deliberately not logged: an error could carry the message
    return json({ error: "unavailable", reply: FIXED[lang].error, route: "error" }, 503);
  }
}

let docsCache;
/** The docs bundle from the static assets (built by scripts/site-build.mjs), once per isolate. */
export function loadDocs(env) {
  docsCache ??= env.ASSETS.fetch("https://kabine.dev/chat/docs.json").then((r) => {
    if (!r.ok) throw new Error("docs bundle missing");
    return r.json();
  });
  docsCache.catch(() => (docsCache = undefined));
  return docsCache;
}

/** One model call with a time limit; one retry when Workers AI is busy (rate limit or capacity). */
async function run(env, model, input, ms) {
  for (let attempt = 0; ; attempt++) {
    let timer;
    try {
      return await Promise.race([
        env.AI.run(model, input, GATEWAY),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms))),
      ]);
    } catch (e) {
      if (attempt === 0 && /\b(3021|3040|2003)\b|rate limit|capacity/i.test(String(e?.message ?? e))) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

const minuteCount = (times, now) => times.filter((t) => t > now - 60_000).length;

/**
 * One message of a visitor, from the rate limit to the reply: { reply, route, steps: [{ step, ms }] }.
 * storage is the visitor's Durable Object storage, budget the global counter (take("triage" | "answer")).
 */
export async function handleMessage({ storage, env, budget, message, lang, now = Date.now() }) {
  const fixed = FIXED[lang];
  const steps = [];
  const timed = async (step, fn) => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      steps.push({ step, ms: Date.now() - t0 });
    }
  };

  // Rate limit of this visitor: nothing is stored when it is reached
  const times = (await storage.get("times")) ?? [];
  const window = core.slidingWindow(times, now, [
    { ms: 60_000, max: LIMITS.perMinute },
    { ms: LIMITS.keepMs, max: LIMITS.perDay },
  ]);
  if (!window.ok) return { reply: minuteCount(times, now) >= LIMITS.perMinute ? fixed.limit : fixed.day, route: "limit", steps };
  await storage.put("times", window.keep);
  await storage.setAlarm(now + LIMITS.keepMs);

  // Personal data: refused before any model when obvious, after Clef otherwise; such a message is never
  // stored, not even in the history (only the time above, for the rate limit)
  const refusePersonal = () => ({ reply: fixed.personal_data, route: "personal_data", steps });
  if (core.hasObviousPersonalData(message)) {
    steps.push({ step: "precheck", ms: 0 });
    return refusePersonal();
  }

  const history = (await storage.get("history")) ?? [];
  const finish = async (reply, route, extra = {}) => {
    const latest = (await storage.get("history")) ?? [];
    latest.push({ role: "user", text: message, at: now, ...(route === "blocked" ? { blocked: true } : {}) });
    latest.push({ role: "assistant", text: reply, route, at: Date.now(), ...(route === "blocked" ? { blocked: true } : {}) });
    await storage.put("history", latest.slice(-LIMITS.history));
    return { reply, route, steps, ...extra };
  };

  if (!(await budget.take("triage"))) return finish(fixed.budget, "budget");

  // Triage: fail closed, no model answers without it
  let scores;
  try {
    scores = core.readTriage(await timed("triage", () => run(env, MODELS.triage, core.triageInput(message, history), TIMEOUT_MS.triage)));
  } catch {
    return finish(fixed.error, "error");
  }
  const route = core.decideRoute(scores);
  if (route === "personal_data") return refusePersonal();
  if (route === "blocked" || route === "off_topic" || route === "greeting" || route === "thanks") return finish(fixed[route], route);

  if (!(await budget.take("answer"))) return finish(fixed.budget, "budget");
  let docs;
  try {
    docs = await loadDocs(env);
  } catch {
    return finish(fixed.error, "error");
  }
  // Sections: Clef, or clef-flash when Clef is busy; without either the FAQ alone
  let ranked = [];
  try {
    ranked = core.readSections(await timed("sections", () => run(env, MODELS.sections, core.sectionsInput(message, history, docs), TIMEOUT_MS.sections)));
  } catch {
    try {
      const input = { ...core.sectionsInput(message, history, docs), model: "clef-flash" };
      ranked = core.readSections(await timed("sections", () => run(env, MODELS.triage, input, TIMEOUT_MS.sections)));
    } catch {
      ranked = [];
    }
  }
  const sections = core.pickSections(ranked, docs);
  let raw;
  try {
    const res = await timed("answer", () =>
      run(env, MODELS.answer, { messages: core.answerMessages({ message, history, sections, docs, lang, route, scores }), reasoning_effort: "low", max_completion_tokens: 3000 }, TIMEOUT_MS.answer),
    );
    raw = res?.choices?.[0]?.message?.content ?? res?.response;
  } catch {
    // No answer, but the sections Clef found may still help
    const links = sections.slice(0, 2).map((s) => `- ${s.title.replace(/ › /g, ": ")}: ${s.url}`);
    return finish(links.length ? `${fixed.error}\n\n${fixed.sections}\n${links.join("\n")}` : fixed.error, "error");
  }
  if (typeof raw === "string" && raw.trim().startsWith(core.OFF_TOPIC)) return finish(fixed.off_topic, "off_topic");
  const reply = core.cleanAnswer(raw, docs, lang);
  return finish(reply ?? fixed.no_answer, route === "unsure" ? "answer_unsure" : "answer");
}

/** One visitor's chat. Its name is the random id the browser created with the first message. */
export class KabineChatVisitor extends DurableObject {
  busy = false;

  async send({ message, lang }) {
    // One message at a time per visitor
    if (this.busy) return { reply: FIXED[lang].limit, route: "limit", steps: [] };
    this.busy = true;
    try {
      const budget = this.env.CHAT_BUDGET.get(this.env.CHAT_BUDGET.idFromName("global"));
      return await handleMessage({ storage: this.ctx.storage, env: this.env, budget: { take: (kind) => budget.take(kind) }, message, lang });
    } finally {
      this.busy = false;
    }
  }

  /** The stored messages for the page, without internals. */
  async history() {
    const history = (await this.ctx.storage.get("history")) ?? [];
    return history.map(({ role, text, route }) => ({ role, text, ...(route ? { route } : {}) }));
  }

  /** "Delete chat" in the panel: everything of this visitor, at once. */
  async forget() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** 24 hours after the last message. */
  async alarm() {
    await this.forget();
  }
}

/** Counts the triage and LLM calls of the whole site: per minute and per day (UTC). Only numbers, no visitor data. */
export class KabineChatBudget extends DurableObject {
  async take(kind) {
    return takeBudget(this.ctx.storage, kind);
  }
}

/** The global budget on a storage: true if one more call of this kind fits, and then counts it. */
export async function takeBudget(storage, kind, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  let b = (await storage.get("budget")) ?? {};
  if (b.day !== day) b = { day, triage: 0, answer: 0, minute: [] };
  if (kind === "triage") {
    const window = core.slidingWindow(b.minute, now, [{ ms: 60_000, max: LIMITS.globalPerMinute }]);
    if (!window.ok || b.triage >= LIMITS.globalTriagePerDay) return false;
    b.minute = window.keep;
    b.triage++;
  } else {
    if (b.answer >= LIMITS.globalAnswersPerDay) return false;
    b.answer++;
  }
  await storage.put("budget", b);
  return true;
}
