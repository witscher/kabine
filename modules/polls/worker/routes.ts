// API of the polls module, mounted under /api: coaches for their teams and groups, admins for the whole club.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, type Ctx, intParam, requireActor } from "../../../worker/app";
import { requireAdmin, requireCoach } from "../../../worker/auth/actor";
import { postSystemMessage } from "../../../worker/domain/chat";
import { enqueuePush } from "../../../worker/domain/notify";
import { batch, first, run, stmt } from "../../../worker/lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound, parse, readJson } from "../../../worker/lib/http";
import { isDate, isLocalDateTime, nowLocal, utcIso } from "../../../worker/lib/time";
import { detectMime } from "../../../worker/routes/avatars";
import { CURRENCIES, normalizeIban, paypalName, type PollTeamInfo } from "../types";
import {
  canEditPoll,
  canManagePoll,
  canSeePoll,
  endsLabel,
  isOpen,
  listPolls,
  loadOptions,
  loadPoll,
  loadPollPayment,
  openPolls,
  type PollRow,
  pollDetail,
  pollRecipients,
  savePollPayment,
  syncVoters,
} from "./domain";

export const routes = new Hono<AppEnv>();

const MAX_OPTIONS = 30;
/** A product photo, shrunk on the device to at most 800 px (usually 50 to 150 KB). */
export const MAX_POLL_IMAGE_BYTES = 300_000;

// Payment (club-wide) ------------------------------------------------------------------------------

const paymentSchema = z.object({
  paypal: z.string().max(80).nullish(),
  holder: z.string().trim().max(70).nullish(),
  iban: z.string().max(42).nullish(),
  currency: z.enum(CURRENCIES).default("EUR"),
});

/** Payment details for orders (Administration → Polls). Coaches may read them too (hint in the poll form). */
routes.get("/polls/payment", async (c) => {
  const actor = requireActor(c);
  if (!actor.isAdmin && !actor.coachTeamIds.length) throw forbidden();
  return c.json(await loadPollPayment(c.env.DB));
});

routes.put("/polls/payment", async (c) => {
  const actor = requireActor(c);
  requireAdmin(actor);
  const input = parse(paymentSchema, await readJson(c.req.raw));
  const paypal = paypalName(input.paypal);
  if (paypal === undefined) throw badRequest(t`Please enter the PayPal.me name, e.g. paypal.me/yourclub.`, "bad_paypal");
  const iban = normalizeIban(input.iban);
  if (iban === undefined) throw badRequest(t`This IBAN is not valid.`, "bad_iban");
  const holder = input.holder?.trim() || null;
  // Account holder and IBAN only together
  if (!!iban !== !!holder) throw badRequest(t`A bank transfer needs both the account holder and the IBAN.`, "bad_iban");
  await savePollPayment(c.env.DB, { paypal, holder, iban, currency: input.currency });
  return c.json(await loadPollPayment(c.env.DB));
});

// Lists ---------------------------------------------------------------------------------------------

routes.get("/polls", async (c) => {
  const actor = requireActor(c);
  const team = c.req.query("teamId");
  const teamId = team === undefined ? undefined : team === "" || team === "club" ? null : Number(team);
  if (teamId != null && !Number.isInteger(teamId)) throw badRequest(t`Unknown team.`);
  return c.json({ polls: await listPolls(c.env.DB, actor, { teamId }) });
});

/** Running polls where the person's vote is missing: cards on the start page, dot on the Events tab. */
routes.get("/polls/open", async (c) => {
  const actor = requireActor(c);
  return c.json({ polls: await openPolls(c.env.DB, actor) });
});

/** For the poll form: kind of the team and whether parents are involved. */
routes.get("/polls/teams/:teamId", async (c) => {
  const actor = requireActor(c);
  const teamId = intParam(c, "teamId");
  requireCoach(actor, teamId);
  const team = await first<{ name: string; kind: "team" | "group"; parents_enabled: number }>(c.env.DB, "SELECT name, kind, parents_enabled FROM teams WHERE id = ?", teamId);
  if (!team) throw notFound();
  return c.json({ name: team.name, kind: team.kind, parentsEnabled: team.parents_enabled === 1 && team.kind === "team" } satisfies PollTeamInfo);
});

// Create and edit ------------------------------------------------------------------------------------

const optionSchema = z.object({
  /** When editing: an existing option (its votes stay); without: new */
  id: z.number().int().positive().optional(),
  label: z.string().trim().max(120).default(""),
  startsAt: z.string().nullish(),
  priceCents: z.number().int().min(0).max(100_000).nullish(),
  sizes: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
});

const pollSchema = z.object({
  teamId: z.number().int().positive().nullable(),
  kind: z.enum(["choice", "schedule", "order"]),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  results: z.enum(["always", "after"]).default("always"),
  perFamily: z.boolean().default(false),
  whoPlayers: z.boolean().default(false),
  whoParents: z.boolean().default(false),
  whoCoaches: z.boolean().default(false),
  endsAt: z.string(),
  options: z.array(optionSchema).min(1).max(MAX_OPTIONS),
});

type PollInput = z.output<typeof pollSchema>;

function checkPoll(input: PollInput, keptEnd?: string): void {
  if (!input.whoPlayers && !input.whoParents && !input.whoCoaches) throw badRequest(t`Please choose who votes.`, "no_voters");
  // When editing, an unchanged end may lie in the past (ended poll)
  if (!isLocalDateTime(input.endsAt) || (input.endsAt <= nowLocal() && input.endsAt !== keptEnd)) throw badRequest(t`The end must lie in the future.`, "bad_end");
  if (input.kind === "order" && input.anonymous) throw badRequest(t`Orders cannot be anonymous.`, "order_anonymous");
  if (input.kind === "choice" && (input.options.length < 2 || input.options.some((o) => !o.label))) {
    throw badRequest(t`Please enter at least two answers.`, "bad_options");
  }
  if (input.kind === "schedule") {
    if (input.options.length < 2) throw badRequest(t`Please enter at least two dates.`, "bad_options");
    if (input.options.some((o) => !o.startsAt || !(isDate(o.startsAt) || isLocalDateTime(o.startsAt)))) throw badRequest(t`A date is not valid.`, "bad_options");
    if (new Set(input.options.map((o) => o.startsAt)).size !== input.options.length) throw badRequest(t`A date is listed twice.`, "bad_options");
  }
  if (input.kind === "order") {
    if (input.options.some((o) => !o.label || o.priceCents == null)) throw badRequest(t`Every item needs a name and a price.`, "bad_options");
    if (input.options.some((o) => new Set(o.sizes).size !== o.sizes.length)) throw badRequest(t`A size is listed twice.`, "bad_options");
  }
}

const optionValues = (kind: PollRow["kind"], o: PollInput["options"][number]) =>
  [
    kind === "schedule" ? "" : o.label,
    kind === "schedule" ? o.startsAt! : null,
    kind === "order" ? o.priceCents! : null,
    kind === "order" && o.sizes.length ? JSON.stringify(o.sizes) : null,
  ] as const;

routes.post("/polls", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const input = parse(pollSchema, await readJson(c.req.raw));
  let teamKind: string = "team";
  if (input.teamId == null) requireAdmin(actor);
  else {
    requireCoach(actor, input.teamId);
    const team = await first<{ kind: string }>(db, "SELECT kind FROM teams WHERE id = ?", input.teamId);
    if (!team) throw notFound(t`Unknown team.`);
    teamKind = team.kind;
  }
  checkPoll(input);
  const poll = (await first<PollRow>(
    db,
    `INSERT INTO polls (team_id, created_by, kind, title, description, multiple, anonymous, results, per_family, who_players, who_parents, who_coaches, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    input.teamId,
    actor.personId,
    input.kind,
    input.title,
    input.description || null,
    input.kind === "choice" && input.multiple ? 1 : 0,
    input.anonymous ? 1 : 0,
    input.results,
    input.perFamily ? 1 : 0,
    input.whoPlayers ? 1 : 0,
    // Groups have no parents
    input.whoParents && teamKind === "team" ? 1 : 0,
    input.whoCoaches ? 1 : 0,
    input.endsAt,
  ))!;
  await batch(
    db,
    input.options.map((o, i) => stmt(db, "INSERT INTO poll_options (poll_id, sort, label, starts_at, price_cents, sizes) VALUES (?, ?, ?, ?, ?, ?)", poll.id, i, ...optionValues(poll.kind, o))),
  );
  await syncVoters(db, poll);
  const team = poll.team_id ? await first<{ name: string }>(db, "SELECT name FROM teams WHERE id = ?", poll.team_id) : null;
  const url = `/umfragen/${poll.id}`;
  const firstName = actor.firstName;
  const title = poll.title;
  // The chat note in the language of the request, like the core's notes
  const note = t`${firstName} started a poll: ${title}`;
  c.executionCtx.waitUntil(
    (async () => {
      await enqueuePush(
        c.env,
        await pollRecipients(db, poll.id, true),
        () => {
          const ends = endsLabel(poll.ends_at);
          const teamName = team?.name;
          return { title: teamName ? t`New poll · ${teamName}` : t`New poll`, body: t`${title} · until ${ends}`, url, tag: `poll-${poll.id}` };
        },
        { exclude: [actor.accountId] },
      );
      if (poll.team_id) await postSystemMessage(c.env, [poll.team_id], note, url);
    })(),
  );
  return c.json({ id: poll.id }, 201);
});

async function visiblePoll(c: Ctx): Promise<PollRow> {
  const actor = requireActor(c);
  const poll = await loadPoll(c.env.DB, intParam(c, "id"));
  if (!poll || !(await canSeePoll(c.env.DB, actor, poll))) throw notFound(t`This poll does not exist.`);
  return poll;
}

routes.get("/polls/:id", async (c) => {
  const actor = requireActor(c);
  return c.json(await pollDetail(c.env.DB, actor, await visiblePoll(c)));
});

/**
 * Edit a poll (creator and admins): title, description, options, who votes, results, end. The kind stays.
 * With votes: changed options keep their votes, removed ones lose them (the form warns). What would reinterpret votes
 * or reveal names is refused: switching "one vote per family" or "multiple answers", lifting "anonymous".
 */
routes.put("/polls/:id", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const poll = await visiblePoll(c);
  if (!canEditPoll(actor, poll)) throw forbidden(t`Only who created the poll and admins may edit it.`);
  const input = parse(pollSchema, await readJson(c.req.raw));
  if (input.kind !== poll.kind || input.teamId !== poll.team_id) throw badRequest(t`The kind and team of a poll stay as they are.`, "fixed");
  checkPoll(input, poll.ends_at);
  const voted = !!(await first(db, "SELECT 1 FROM poll_ballots WHERE poll_id = ? LIMIT 1", poll.id));
  if (voted) {
    if (input.perFamily !== (poll.per_family === 1)) throw conflict(t`There are votes already: “One vote per family” stays as it is.`, "votes_exist");
    if (poll.kind === "choice" && input.multiple !== (poll.multiple === 1)) throw conflict(t`There are votes already: “Multiple answers” stays as it is.`, "votes_exist");
    if (poll.anonymous === 1 && !input.anonymous) throw conflict(t`There are votes already: an anonymous poll stays anonymous.`, "votes_exist");
  }
  const existing = new Set((await loadOptions(db, poll.id)).map((o) => o.id));
  if (input.options.some((o) => o.id != null && !existing.has(o.id))) throw badRequest(t`This answer does not exist.`, "bad_options");
  const kept = new Set(input.options.map((o) => o.id).filter((id): id is number => id != null));
  const team = poll.team_id ? await first<{ kind: string }>(db, "SELECT kind FROM teams WHERE id = ?", poll.team_id) : null;
  const now = nowLocal();
  await batch(db, [
    stmt(
      db,
      `UPDATE polls SET title = ?, description = ?, multiple = ?, anonymous = ?, results = ?, per_family = ?, who_players = ?, who_parents = ?,
              who_coaches = ?, ends_at = ?, closed_at = CASE WHEN ? <> ends_at AND ? > ? THEN NULL ELSE closed_at END,
              reminded_at = CASE WHEN ? <> ends_at THEN NULL ELSE reminded_at END
        WHERE id = ?`,
      input.title,
      input.description || null,
      poll.kind === "choice" && input.multiple ? 1 : 0,
      input.anonymous ? 1 : 0,
      input.results,
      input.perFamily ? 1 : 0,
      input.whoPlayers ? 1 : 0,
      input.whoParents && (team?.kind ?? "team") === "team" ? 1 : 0,
      input.whoCoaches ? 1 : 0,
      input.endsAt,
      input.endsAt,
      input.endsAt,
      now,
      input.endsAt,
      poll.id,
    ),
    // Removed options (with their votes); removed sizes of orders
    ...[...existing].filter((id) => !kept.has(id)).map((id) => stmt(db, "DELETE FROM poll_options WHERE id = ?", id)),
    ...input.options
      .filter((o) => o.id != null && poll.kind === "order")
      .map((o) => {
        const sizes = optionValues(poll.kind, o)[3];
        return stmt(
          db,
          "DELETE FROM poll_answers WHERE option_id = ? AND (CASE WHEN ? IS NULL THEN size <> '' ELSE size NOT IN (SELECT value FROM json_each(?)) END)",
          o.id!,
          sizes,
          sizes ?? "[]",
        );
      }),
    ...input.options.map((o, i) =>
      o.id != null
        ? stmt(db, "UPDATE poll_options SET sort = ?, label = ?, starts_at = ?, price_cents = ?, sizes = ? WHERE id = ? AND poll_id = ?", i, ...optionValues(poll.kind, o), o.id, poll.id)
        : stmt(db, "INSERT INTO poll_options (poll_id, sort, label, starts_at, price_cents, sizes) VALUES (?, ?, ?, ?, ?, ?)", poll.id, i, ...optionValues(poll.kind, o)),
    ),
    // Choice: whoever's only answer was removed votes again (the card on the start page appears again)
    ...(poll.kind === "choice"
      ? [
          stmt(
            db,
            "DELETE FROM poll_ballots WHERE poll_id = ?1 AND NOT EXISTS (SELECT 1 FROM poll_answers a WHERE a.poll_id = ?1 AND a.unit_id = poll_ballots.unit_id)",
            poll.id,
          ),
        ]
      : []),
  ]);
  const updated = (await loadPoll(db, poll.id))!;
  await syncVoters(db, updated);
  return c.json(await pollDetail(db, actor, updated));
});

const editSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullish(),
  endsAt: z.string().optional(),
});

/** Change title, description or end (managers, e.g. team coaches); a later end reopens an ended poll. Options stay. */
routes.patch("/polls/:id", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (!canManagePoll(actor, poll)) throw forbidden(t`Only who manages the poll may do this.`);
  const input = parse(editSchema, await readJson(c.req.raw));
  if (input.endsAt !== undefined && (!isLocalDateTime(input.endsAt) || input.endsAt <= nowLocal())) throw badRequest(t`The end must lie in the future.`, "bad_end");
  await run(
    c.env.DB,
    `UPDATE polls SET title = coalesce(?, title), description = CASE WHEN ? THEN ? ELSE description END,
            ends_at = coalesce(?, ends_at), closed_at = CASE WHEN ? IS NULL THEN closed_at ELSE NULL END,
            reminded_at = CASE WHEN ? IS NULL THEN reminded_at ELSE NULL END
      WHERE id = ?`,
    input.title ?? null,
    input.description !== undefined ? 1 : 0,
    input.description || null,
    input.endsAt ?? null,
    input.endsAt ?? null,
    input.endsAt ?? null,
    poll.id,
  );
  return c.json(await pollDetail(c.env.DB, actor, (await loadPoll(c.env.DB, poll.id))!));
});

routes.post("/polls/:id/close", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (!canManagePoll(actor, poll)) throw forbidden(t`Only who manages the poll may do this.`);
  if (isOpen(poll)) await run(c.env.DB, "UPDATE polls SET closed_at = ? WHERE id = ?", utcIso(), poll.id);
  return c.json(await pollDetail(c.env.DB, actor, (await loadPoll(c.env.DB, poll.id))!));
});

routes.delete("/polls/:id", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (!canManagePoll(actor, poll)) throw forbidden(t`Only who manages the poll may do this.`);
  await run(c.env.DB, "DELETE FROM polls WHERE id = ?", poll.id);
  return c.json({ ok: true });
});

// Product photos -------------------------------------------------------------------------------------

async function pollOption(c: Ctx, poll: PollRow): Promise<number> {
  const optionId = intParam(c, "optionId");
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM poll_options WHERE id = ? AND poll_id = ?", optionId, poll.id))) throw notFound(t`This item does not exist.`);
  return optionId;
}

async function editableOrderOption(c: Ctx) {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (!canEditPoll(actor, poll)) throw forbidden(t`Only who created the poll and admins may change photos.`);
  if (poll.kind !== "order") throw badRequest(t`Only orders have photos.`, "not_order");
  return { actor, poll, optionId: await pollOption(c, poll) };
}

/** Like profile pictures: with a matching version in the URL the photo never changes, a new one gets a new version. */
routes.get("/polls/:id/options/:optionId/image", async (c) => {
  const poll = await visiblePoll(c);
  const optionId = await pollOption(c, poll);
  const row = await first<{ mime: string; image: ArrayBuffer | number[]; version: number }>(
    c.env.DB,
    "SELECT mime, image, version FROM poll_option_images WHERE option_id = ?",
    optionId,
  );
  if (!row) throw notFound();
  const bytes = row.image instanceof ArrayBuffer ? new Uint8Array(row.image) : Uint8Array.from(row.image);
  const cacheable = c.req.query("v") === String(row.version);
  return new Response(bytes, {
    headers: {
      "content-type": row.mime,
      "cache-control": cacheable ? "private, max-age=31536000, immutable" : "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
});

routes.put("/polls/:id/options/:optionId/image", async (c) => {
  const { actor, poll, optionId } = await editableOrderOption(c);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_POLL_IMAGE_BYTES) throw new ApiError(413, "too_large", t`The photo is too large.`);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_POLL_IMAGE_BYTES) throw new ApiError(413, "too_large", t`The photo is too large.`);
  const mime = detectMime(bytes);
  if (!mime) throw badRequest(t`Please upload a picture in JPEG or WebP format.`);
  await run(
    c.env.DB,
    `INSERT INTO poll_option_images (option_id, mime, image, version, uploaded_by) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (option_id) DO UPDATE SET mime = excluded.mime, image = excluded.image, version = poll_option_images.version + 1,
       uploaded_by = excluded.uploaded_by, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    optionId,
    mime,
    bytes,
    actor.personId,
  );
  return c.json(await pollDetail(c.env.DB, actor, poll));
});

routes.delete("/polls/:id/options/:optionId/image", async (c) => {
  const { actor, poll, optionId } = await editableOrderOption(c);
  await run(c.env.DB, "DELETE FROM poll_option_images WHERE option_id = ?", optionId);
  return c.json(await pollDetail(c.env.DB, actor, poll));
});

// Voting -------------------------------------------------------------------------------------------

const ballotSchema = z.object({
  unitId: z.number().int().positive(),
  answers: z
    .array(z.object({ optionId: z.number().int().positive(), size: z.string().max(20).default(""), value: z.number().int().min(0).max(99) }))
    .max(MAX_OPTIONS * 20),
});

async function requireVoter(db: D1Database, pollId: number, unitId: number, personId: number): Promise<void> {
  const ok = await first(db, "SELECT 1 FROM poll_voters WHERE poll_id = ? AND unit_id = ? AND person_id = ? AND can_vote = 1", pollId, unitId, personId);
  if (!ok) throw forbidden(t`You cannot vote here.`, "not_voter");
}

/** Vote or change the own vote while the poll runs. */
routes.put("/polls/:id/ballot", async (c) => {
  const actor = requireActor(c);
  const db = c.env.DB;
  const poll = await visiblePoll(c);
  const input = parse(ballotSchema, await readJson(c.req.raw));
  if (!isOpen(poll)) throw badRequest(t`The poll has ended.`, "closed");
  await requireVoter(db, poll.id, input.unitId, actor.personId);
  const options = new Map((await loadOptions(db, poll.id)).map((o) => [o.id, o]));
  const seen = new Set<string>();
  for (const a of input.answers) {
    const o = options.get(a.optionId);
    if (!o) throw badRequest(t`This answer does not exist.`, "bad_answer");
    const k = `${a.optionId}|${a.size}`;
    if (seen.has(k)) throw badRequest(t`An answer is listed twice.`, "bad_answer");
    seen.add(k);
    if (poll.kind === "order") {
      if (o.sizes.length ? !o.sizes.includes(a.size) : a.size !== "") throw badRequest(t`This size does not exist.`, "bad_answer");
    } else if (a.size !== "") throw badRequest(t`Invalid answer.`, "bad_answer");
    if (poll.kind === "choice" && a.value !== 1) throw badRequest(t`Invalid answer.`, "bad_answer");
    if (poll.kind === "schedule" && a.value > 2) throw badRequest(t`Invalid answer.`, "bad_answer");
  }
  const answers = input.answers.filter((a) => a.value > 0 || poll.kind === "schedule");
  if (poll.kind === "choice") {
    if (!answers.length) throw badRequest(t`Please choose an answer.`, "no_answer");
    if (!poll.multiple && answers.length > 1) throw badRequest(t`Only one answer is possible here.`, "single_answer");
  }
  if (poll.kind === "schedule" && answers.length !== options.size) throw badRequest(t`Please answer every date.`, "no_answer");
  await batch(db, [
    // Whoever orders after all no longer ignores it (if they withdraw, the card appears again)
    stmt(db, "DELETE FROM poll_ignores WHERE poll_id = ? AND person_id = ?", poll.id, actor.personId),
    stmt(db, "DELETE FROM poll_answers WHERE poll_id = ? AND unit_id = ?", poll.id, input.unitId),
    ...answers.map((a) => stmt(db, "INSERT INTO poll_answers (poll_id, unit_id, option_id, size, value) VALUES (?, ?, ?, ?, ?)", poll.id, input.unitId, a.optionId, a.size, a.value)),
    stmt(
      db,
      // Orders get a number the first time (bank reference), which stays when the order changes
      `INSERT INTO poll_ballots (poll_id, unit_id, voted_by, updated_at, order_no)
       VALUES (?1, ?2, ?3, ?4, CASE WHEN ?5 THEN (SELECT coalesce(max(order_no), 0) + 1 FROM poll_ballots WHERE poll_id = ?1) END)
       ON CONFLICT (poll_id, unit_id) DO UPDATE SET voted_by = excluded.voted_by, updated_at = excluded.updated_at`,
      poll.id,
      input.unitId,
      actor.personId,
      utcIso(),
      poll.kind === "order" ? 1 : 0,
    ),
  ]);
  return c.json(await pollDetail(db, actor, poll));
});

/** Ignore an order (or show it again): only the own person, only running orders the person may order in. */
routes.put("/polls/:id/ignore", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  const { ignored } = parse(z.object({ ignored: z.boolean() }), await readJson(c.req.raw));
  if (poll.kind !== "order") throw badRequest(t`Only orders can be ignored.`, "not_order");
  if (!isOpen(poll)) throw badRequest(t`The poll has ended.`, "closed");
  if (!(await first(c.env.DB, "SELECT 1 FROM poll_voters WHERE poll_id = ? AND person_id = ? AND can_vote = 1", poll.id, actor.personId))) {
    throw forbidden(t`You cannot order here.`, "not_voter");
  }
  if (ignored) await run(c.env.DB, "INSERT OR IGNORE INTO poll_ignores (poll_id, person_id, created_at) VALUES (?, ?, ?)", poll.id, actor.personId, utcIso());
  else await run(c.env.DB, "DELETE FROM poll_ignores WHERE poll_id = ? AND person_id = ?", poll.id, actor.personId);
  return c.json({ ok: true });
});

/** Withdraw a vote while the poll runs. */
routes.delete("/polls/:id/ballot/:unitId", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (!isOpen(poll)) throw badRequest(t`The poll has ended.`, "closed");
  const unitId = intParam(c, "unitId");
  await requireVoter(c.env.DB, poll.id, unitId, actor.personId);
  // A paid order is not thrown away (the paid amount would be lost); changing it, even to nothing, works
  const paid = await first<{ paid_cents: number | null }>(c.env.DB, "SELECT paid_cents FROM poll_ballots WHERE poll_id = ? AND unit_id = ?", poll.id, unitId);
  if ((paid?.paid_cents ?? 0) > 0) throw conflict(t`This order is paid already. Change it instead.`, "already_paid");
  await batch(c.env.DB, [
    stmt(c.env.DB, "DELETE FROM poll_answers WHERE poll_id = ? AND unit_id = ?", poll.id, unitId),
    stmt(c.env.DB, "DELETE FROM poll_ballots WHERE poll_id = ? AND unit_id = ?", poll.id, unitId),
  ]);
  return c.json(await pollDetail(c.env.DB, actor, poll));
});

// Payments ----------------------------------------------------------------------------------------------

/** Current amount of an order in SQL (quantity × price). */
const ORDER_TOTAL_SQL = `(SELECT COALESCE(SUM(a.value * COALESCE(o.price_cents, 0)), 0)
   FROM poll_answers a JOIN poll_options o ON o.id = a.option_id
  WHERE a.poll_id = poll_ballots.poll_id AND a.unit_id = poll_ballots.unit_id)`;

/**
 * Confirm a payment (creator, admins). The current amount is confirmed; if the family orders more later, the rest
 * stays open. Unticking resets the confirmed amount.
 */
routes.put("/polls/:id/ballot/:unitId/paid", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (poll.kind !== "order" || !canEditPoll(actor, poll)) throw forbidden(t`Only who created the order may do this.`);
  const { paid } = parse(z.object({ paid: z.boolean() }), await readJson(c.req.raw));
  const unitId = intParam(c, "unitId");
  const res = paid
    ? await run(c.env.DB, `UPDATE poll_ballots SET paid_at = ?, paid_cents = ${ORDER_TOTAL_SQL} WHERE poll_id = ? AND unit_id = ?`, utcIso(), poll.id, unitId)
    : await run(c.env.DB, "UPDATE poll_ballots SET paid_at = NULL, paid_cents = NULL WHERE poll_id = ? AND unit_id = ?", poll.id, unitId);
  if (!res.meta.changes) throw notFound(t`This order does not exist.`);
  return c.json(await pollDetail(c.env.DB, actor, poll));
});

/**
 * "I have paid" (whoever may order for the unit): the current amount is reported; the creator still confirms it.
 * Also after the poll ended.
 */
routes.put("/polls/:id/ballot/:unitId/reported", async (c) => {
  const actor = requireActor(c);
  const poll = await visiblePoll(c);
  if (poll.kind !== "order") throw badRequest(t`Only orders are paid.`, "not_order");
  const { reported } = parse(z.object({ reported: z.boolean() }), await readJson(c.req.raw));
  const unitId = intParam(c, "unitId");
  await requireVoter(c.env.DB, poll.id, unitId, actor.personId);
  const res = reported
    ? await run(
        c.env.DB,
        `UPDATE poll_ballots SET reported_cents = ${ORDER_TOTAL_SQL}, reported_at = ?, reported_by = ? WHERE poll_id = ? AND unit_id = ?`,
        utcIso(),
        actor.personId,
        poll.id,
        unitId,
      )
    : await run(c.env.DB, "UPDATE poll_ballots SET reported_cents = NULL, reported_at = NULL, reported_by = NULL WHERE poll_id = ? AND unit_id = ?", poll.id, unitId);
  if (!res.meta.changes) throw notFound(t`This order does not exist.`);
  return c.json(await pollDetail(c.env.DB, actor, poll));
});
