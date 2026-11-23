// Polls: choice, scheduling and orders (modules/polls/README.md).
//
// Who votes is in poll_voters: one unit per person or per family (unit_id) with its members (named in it) and the
// persons who may vote for it (e.g. parents for their child). The list is built when a poll starts and synced hourly
// while it runs, only when teams or parent links changed since (cache versions, worker/lib/cache.ts).
import { t } from "@lingui/core/macro";
import type { Actor } from "../../../worker/auth/actor";
import { enqueuePush, shortDate, shortTime } from "../../../worker/domain/notify";
import { currentLocale } from "../../../worker/i18n";
import { cachedRoster, cachedTeamInfo } from "../../../worker/domain/events";
import { cacheVersions } from "../../../worker/lib/cache";
import { all, batch, first, list, run, stmt } from "../../../worker/lib/db";
import { addMinutesLocal, nowLocal, utcIso } from "../../../worker/lib/time";
import { type PaymentAmounts, type PollDetail, type PollKind, type PollOption, type PollOrder, type PollPayment, type PollSummary, type PollTally, type PollUnit, paymentReference, paymentState } from "../types";

export interface PollRow {
  id: number;
  team_id: number | null;
  created_by: number | null;
  kind: PollKind;
  title: string;
  description: string | null;
  multiple: number;
  anonymous: number;
  results: "always" | "after";
  per_family: number;
  who_players: number;
  who_parents: number;
  who_coaches: number;
  ends_at: string;
  closed_at: string | null;
  reminded_at: string | null;
  voters_synced: string | null;
  created_at: string;
}

const PAYMENT_KEY = "polls_payment";

/** Payment details for orders, for the whole club (Administration → Polls). */
export async function loadPollPayment(db: D1Database): Promise<PollPayment> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", PAYMENT_KEY);
  const v = row ? (JSON.parse(row.value) as Partial<PollPayment>) : {};
  return { paypal: v.paypal ?? null, holder: v.holder ?? null, iban: v.iban ?? null, currency: v.currency ?? "EUR" };
}

export async function savePollPayment(db: D1Database, p: PollPayment): Promise<void> {
  if (!p.paypal && !p.iban && p.currency === "EUR") await run(db, "DELETE FROM app_meta WHERE key = ?", PAYMENT_KEY);
  else await run(db, "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", PAYMENT_KEY, JSON.stringify(p));
}

interface OptionRow {
  id: number;
  poll_id: number;
  sort: number;
  label: string;
  starts_at: string | null;
  price_cents: number | null;
  sizes: string | null;
  image_version: number | null;
}

export function isOpen(p: Pick<PollRow, "closed_at" | "ends_at">, now = nowLocal()): boolean {
  return !p.closed_at && p.ends_at > now;
}

/** Creator, coaches of the team or group and admins manage a poll and always see the result. */
export function canManagePoll(actor: Actor, p: Pick<PollRow, "team_id" | "created_by">): boolean {
  return actor.isAdmin || p.created_by === actor.personId || (p.team_id != null && actor.coachTeamIds.includes(p.team_id));
}

/** Editing everything, product photos and "paid": the creator, admins as fallback. */
export function canEditPoll(actor: Actor, p: Pick<PollRow, "created_by">): boolean {
  return actor.isAdmin || p.created_by === actor.personId;
}

export async function loadPoll(db: D1Database, id: number): Promise<PollRow | null> {
  return first<PollRow>(db, "SELECT * FROM polls WHERE id = ?", id);
}

/** Does the account see the poll? Whoever may vote or manages it. */
export async function canSeePoll(db: D1Database, actor: Actor, p: PollRow): Promise<boolean> {
  if (canManagePoll(actor, p)) return true;
  return !!(await first(db, "SELECT 1 FROM poll_voters WHERE poll_id = ? AND person_id = ? AND can_vote = 1", p.id, actor.personId));
}

// Voters ------------------------------------------------------------------------------------------

export interface VoterRow {
  unit_id: number;
  person_id: number;
  is_member: number;
  can_vote: number;
}

/**
 * Who votes? Players (for children also the parents where they are involved; for orders only the parents), parents of
 * players in teams with parents, coaches or leads. Without a team: the whole club (all teams, no groups). One vote per
 * family: whoever is connected through parent links (parents, children, siblings, patchwork) is one unit.
 */
export async function computeVoters(db: D1Database, p: PollRow): Promise<VoterRow[]> {
  const scope = `SELECT id, CASE WHEN kind = 'team' THEN parents_enabled ELSE 0 END AS parents_enabled FROM teams
                  WHERE (?1 IS NULL AND kind = 'team') OR id = ?1`;
  const [members, guardians] = await Promise.all([
    all<{ person_id: number; role: string; parents_enabled: number }>(
      db,
      `SELECT tm.person_id, tm.role, s.parents_enabled
         FROM team_memberships tm JOIN (${scope}) s ON s.id = tm.team_id
         JOIN persons p ON p.id = tm.person_id AND p.is_former = 0
        WHERE tm.role IN ('player', 'coach')`,
      p.team_id,
    ),
    all<{ guardian_id: number; child_id: number }>(
      db,
      `SELECT g.guardian_id, g.child_id FROM guardianships g
         JOIN persons gp ON gp.id = g.guardian_id AND gp.is_former = 0
         JOIN persons cp ON cp.id = g.child_id AND cp.is_former = 0`,
    ),
  ]);
  const guardiansOf = new Map<number, number[]>();
  for (const g of guardians) guardiansOf.set(g.child_id, [...(guardiansOf.get(g.child_id) ?? []), g.guardian_id]);

  // Who belongs (eligible) and who may vote for them (actors)?
  const actors = new Map<number, Set<number>>();
  const add = (person: number, actor?: number) => {
    const set = actors.get(person) ?? new Set<number>();
    if (actor != null) set.add(actor);
    actors.set(person, set);
  };
  for (const m of members) {
    if (m.role === "coach") {
      if (p.who_coaches) add(m.person_id, m.person_id);
      continue;
    }
    const parents = m.parents_enabled ? (guardiansOf.get(m.person_id) ?? []) : [];
    if (p.who_players) {
      // Orders: where parents are involved, they order for their child
      add(m.person_id, p.kind === "order" && parents.length ? undefined : m.person_id);
      for (const g of parents) add(m.person_id, g);
    }
    if (p.who_parents) for (const g of parents) add(g, g);
  }

  const rows: VoterRow[] = [];
  if (!p.per_family) {
    for (const [person, set] of actors) {
      rows.push({ unit_id: person, person_id: person, is_member: 1, can_vote: set.has(person) ? 1 : 0 });
      for (const a of set) if (a !== person) rows.push({ unit_id: person, person_id: a, is_member: 0, can_vote: 1 });
    }
    return rows;
  }

  // Families: connected parent links (parents, children, siblings, patchwork)
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (y !== r) {
      const next = parent.get(y) ?? r;
      parent.set(y, r);
      y = next;
    }
    return r;
  };
  for (const g of guardians) {
    const a = find(g.guardian_id);
    const b = find(g.child_id);
    if (a !== b) parent.set(a, b);
  }
  // Existing units keep their number, so votes stay
  const [existing, ballots] = await Promise.all([
    all<{ unit_id: number; person_id: number }>(db, "SELECT unit_id, person_id FROM poll_voters WHERE poll_id = ?", p.id),
    all<{ unit_id: number }>(db, "SELECT unit_id FROM poll_ballots WHERE poll_id = ?", p.id),
  ]);
  const voted = new Set(ballots.map((b) => b.unit_id));
  const families = new Map<number, { members: Set<number>; actors: Set<number> }>();
  for (const [person, set] of actors) {
    const root = find(person);
    const f = families.get(root) ?? { members: new Set<number>(), actors: new Set<number>() };
    f.members.add(person);
    for (const a of set) f.actors.add(a);
    families.set(root, f);
  }
  const unitOf = new Map<number, number>();
  for (const e of existing) unitOf.set(e.person_id, e.unit_id);
  for (const f of families.values()) {
    const everyone = new Set([...f.members, ...f.actors]);
    const known = [...everyone].map((x) => unitOf.get(x)).filter((u): u is number => u != null);
    const unit = known.find((u) => voted.has(u)) ?? known[0] ?? Math.min(...f.members);
    for (const x of everyone) rows.push({ unit_id: unit, person_id: x, is_member: f.members.has(x) ? 1 : 0, can_vote: f.actors.has(x) ? 1 : 0 });
  }
  return rows;
}

const key = (r: VoterRow) => `${r.unit_id}:${r.person_id}:${r.is_member}:${r.can_vote}`;

/** The cache versions voters depend on: teams (parents involved) and the roster (memberships, parent links, leaving). */
async function voterVersions(db: D1Database): Promise<string> {
  const v = await cacheVersions(db);
  return `${v.ref}:${v.roster}`;
}

/** Syncs the voters; writes only if something changed. `versions`: skip when nothing changed since the last sync. */
export async function syncVoters(db: D1Database, p: PollRow, versions?: string): Promise<boolean> {
  const current = versions ?? (await voterVersions(db));
  if (versions && p.voters_synced === versions && !versions.includes("-1")) return false;
  const [desired, stored] = await Promise.all([
    computeVoters(db, p),
    all<VoterRow>(db, "SELECT unit_id, person_id, is_member, can_vote FROM poll_voters WHERE poll_id = ?", p.id),
  ]);
  const same = desired.map(key).sort().join(",") === stored.map(key).sort().join(",");
  await batch(db, [
    ...(same
      ? []
      : [
          stmt(db, "DELETE FROM poll_voters WHERE poll_id = ?", p.id),
          stmt(
            db,
            `INSERT INTO poll_voters (poll_id, unit_id, person_id, is_member, can_vote)
             SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
               FROM json_each(?2)`,
            p.id,
            JSON.stringify(desired.map((r) => [r.unit_id, r.person_id, r.is_member, r.can_vote])),
          ),
        ]),
    stmt(db, "UPDATE polls SET voters_synced = ? WHERE id = ?", current, p.id),
  ]);
  return !same;
}

// Names -------------------------------------------------------------------------------------------

interface MemberRow {
  unit_id: number;
  id: number;
  first_name: string;
  last_name: string | null;
  is_child: number;
}

const fullName = (m: { first_name: string; last_name: string | null }) => (m.last_name ? `${m.first_name} ${m.last_name}` : m.first_name);
const shortName = (m: { first_name: string; last_name: string | null }) => (m.last_name ? `${m.first_name} ${m.last_name.charAt(0)}.` : m.first_name);

function joinNames(names: string[]): string {
  return new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" }).format(names);
}

const compare = (a: string, b: string) => a.localeCompare(b, currentLocale());

/**
 * Name of a unit: the person; for families "Family of" and the children (without children the adults).
 * Managers (full) read first and last names and the person's other teams, so they can hand out an order:
 * "Family Kaiser: Ben (U13 boys), Kim" when the children share a last name, else each child with the full name.
 */
function unitLabel(members: MemberRow[], perFamily: boolean, full: boolean, teamsOf?: Map<number, string[]>): string {
  const teams = (m: MemberRow) => {
    const names = teamsOf?.get(m.id);
    return names?.length ? ` (${names.join(", ")})` : "";
  };
  const withTeams = (m: MemberRow) => `${fullName(m)}${teams(m)}`;
  const name = full ? withTeams : shortName;
  if (!members.length) return t`Former member`;
  if (!perFamily) return name(members[0]!);
  const kids = members.filter((m) => m.is_child);
  if (!kids.length) return joinNames(members.map(name));
  if (!full) {
    const names = joinNames(kids.map((k) => k.first_name));
    return t`Family of ${names}`;
  }
  const last = kids[0]!.last_name;
  if (last && kids.every((k) => k.last_name === last)) {
    const names = kids.map((k) => `${k.first_name}${teams(k)}`).join(", ");
    return t({ message: `Family ${last}: ${names}`, comment: "Order list for managers: last name, then the children with their teams" });
  }
  const names = joinNames(kids.map(withTeams));
  return t`Family of ${names}`;
}

/**
 * For managers: the player teams of each person, without the poll's own team and without groups. From the cache per
 * Worker instance (worker/lib/cache.ts), which the event list keeps current anyway: no rows read most of the time.
 */
async function otherTeams(db: D1Database, pollTeamId: number | null): Promise<Map<number, string[]>> {
  const versions = await cacheVersions(db);
  const [teams, roster] = await Promise.all([cachedTeamInfo(db, versions), cachedRoster(db, versions)]);
  const teamName = new Map(teams.filter((x) => x.kind === "team").map((x) => [x.id, x.name]));
  const out = new Map<number, string[]>();
  for (const r of roster) {
    if (r.role !== "player" || r.team_id === pollTeamId) continue;
    const name = teamName.get(r.team_id);
    if (name) out.set(r.person_id, [...(out.get(r.person_id) ?? []), name]);
  }
  return out;
}

/** Members per unit; `units`: only these (see pollDetail). */
async function loadMembers(db: D1Database, pollId: number, units: number[] | null = null): Promise<Map<number, MemberRow[]>> {
  const rows = await all<MemberRow>(
    db,
    `SELECT pv.unit_id, p.id, p.first_name, p.last_name, EXISTS (SELECT 1 FROM guardianships g WHERE g.child_id = p.id) AS is_child
       FROM poll_voters pv JOIN persons p ON p.id = pv.person_id
      WHERE pv.poll_id = ?1 AND pv.is_member = 1${units ? " AND pv.unit_id IN (SELECT value FROM json_each(?2))" : ""}
      ORDER BY p.first_name, p.id`,
    ...(units ? [pollId, list(units)] : [pollId]),
  );
  const byUnit = new Map<number, MemberRow[]>();
  for (const r of rows) byUnit.set(r.unit_id, [...(byUnit.get(r.unit_id) ?? []), r]);
  return byUnit;
}

// View --------------------------------------------------------------------------------------------

/** Address of a product photo: like profile pictures, with the version, so the browser keeps it until it changes. */
export function pollImageUrl(pollId: number, optionId: number, version: number): string {
  return `/api/polls/${pollId}/options/${optionId}/image?v=${version}`;
}

export async function loadOptions(db: D1Database, pollId: number): Promise<PollOption[]> {
  const rows = await all<OptionRow>(
    db,
    "SELECT o.*, i.version AS image_version FROM poll_options o LEFT JOIN poll_option_images i ON i.option_id = o.id WHERE o.poll_id = ? ORDER BY o.sort, o.id",
    pollId,
  );
  return rows.map((o) => ({
    id: o.id,
    label: o.label,
    startsAt: o.starts_at,
    priceCents: o.price_cents,
    sizes: o.sizes ? (JSON.parse(o.sizes) as string[]) : [],
    imageUrl: o.image_version != null ? pollImageUrl(pollId, o.id, o.image_version) : null,
  }));
}

export async function pollDetail(db: D1Database, actor: Actor, p: PollRow): Promise<PollDetail> {
  const manage = canManagePoll(actor, p);
  const open = isOpen(p);
  // Orders for participants: load only the own units, they see nothing of the others (read load, README). Starts from
  // the person's voter rows (index poll_voters_person) instead of every voter of the poll.
  const ownUnits =
    p.kind === "order" && !manage
      ? (
          await all<{ unit_id: number }>(db, "SELECT DISTINCT unit_id FROM poll_voters WHERE person_id = ?1 AND can_vote = 1 AND poll_id = ?2", actor.personId, p.id)
        ).map((r) => r.unit_id)
      : null;
  // A separate SQL fragment instead of "?2 IS NULL OR unit_id IN (…)": with the OR, SQLite uses only the poll_id prefix
  // of the primary key (poll_id, unit_id, …) and reads every row of the poll
  const onlyOwn = (column: string) => (ownUnits ? ` AND ${column} IN (SELECT value FROM json_each(?2))` : "");
  const params = ownUnits ? [p.id, list(ownUnits)] : [p.id];
  const [options, voters, ballots, answers, members, team, creator, pay, teamsOf] = await Promise.all([
    loadOptions(db, p.id),
    all<VoterRow>(db, `SELECT unit_id, person_id, is_member, can_vote FROM poll_voters WHERE poll_id = ?1${onlyOwn("unit_id")}`, ...params),
    all<{
      unit_id: number;
      voted_by: number | null;
      updated_at: string;
      paid_cents: number | null;
      reported_cents: number | null;
      order_no: number | null;
      voter_first: string | null;
    }>(
      db,
      `SELECT b.unit_id, b.voted_by, b.updated_at, b.paid_cents, b.reported_cents, b.order_no, vp.first_name AS voter_first
         FROM poll_ballots b LEFT JOIN persons vp ON vp.id = b.voted_by
        WHERE b.poll_id = ?1${onlyOwn("b.unit_id")}`,
      ...params,
    ),
    all<{ unit_id: number; option_id: number; size: string; value: number }>(
      db,
      `SELECT unit_id, option_id, size, value FROM poll_answers WHERE poll_id = ?1${onlyOwn("unit_id")}`,
      ...params,
    ),
    loadMembers(db, p.id, ownUnits),
    p.team_id ? first<{ name: string }>(db, "SELECT name FROM teams WHERE id = ?", p.team_id) : null,
    p.created_by ? first<{ first_name: string; last_name: string | null }>(db, "SELECT first_name, last_name FROM persons WHERE id = ?", p.created_by) : null,
    loadPollPayment(db),
    manage ? otherTeams(db, p.team_id) : undefined,
  ]);
  const isOrder = p.kind === "order";
  const perFamily = p.per_family === 1;
  const anonymous = p.anonymous === 1;
  const units = new Set(voters.map((v) => v.unit_id));
  const ballotOf = new Map(ballots.map((b) => [b.unit_id, b]));
  const answersOf = new Map<number, { optionId: number; size: string; value: number }[]>();
  for (const a of answers) answersOf.set(a.unit_id, [...(answersOf.get(a.unit_id) ?? []), { optionId: a.option_id, size: a.size, value: a.value }]);
  // Former units (e.g. left the team) count with their vote but are no longer in any list
  const label = (unit: number, full: boolean) => unitLabel(members.get(unit) ?? [], perFamily, full, full ? teamsOf : undefined);
  // Orders: amount per unit and payment state (confirmed, reported)
  const priceOf = new Map(options.map((o) => [o.id, o.priceCents ?? 0]));
  const totalOf = (unit: number) => (answersOf.get(unit) ?? []).reduce((sum, a) => sum + (priceOf.get(a.optionId) ?? 0) * a.value, 0);
  const amountsOf = (unit: number): PaymentAmounts => {
    const b = ballotOf.get(unit);
    return { totalCents: totalOf(unit), paidCents: b?.paid_cents ?? 0, reportedCents: b?.reported_cents ?? 0 };
  };

  const myUnits: PollUnit[] = [...new Set(voters.filter((v) => v.person_id === actor.personId && v.can_vote).map((v) => v.unit_id))].map((unit) => {
    const b = ballotOf.get(unit);
    const unitMembers = members.get(unit) ?? [];
    const self = unitMembers.some((m) => m.id === actor.personId);
    // A family of only you (e.g. a coach without children in the app): "you"
    const who: PollUnit["who"] = self && unitMembers.length === 1 ? "self" : perFamily ? "family" : self ? "self" : "other";
    const reference = isOrder && b?.order_no ? paymentReference(p.title, b.order_no, t({ message: "No.", comment: "Order number in a bank reference, e.g. 'Club kit No. 17'" })) : null;
    const topUp = (b?.paid_cents ?? 0) > 0 || (b?.reported_cents ?? 0) > 0;
    return {
      unitId: unit,
      who,
      name: label(unit, false),
      answers: b ? (answersOf.get(unit) ?? []) : null,
      votedBy: b && perFamily && b.voted_by !== actor.personId ? b.voter_first : null,
      updatedAt: b?.updated_at ?? null,
      orderNo: isOrder ? (b?.order_no ?? null) : null,
      reference,
      // PayPal cannot take a message from the link: the note names order number and players (children included), so the
      // creator can match the payment; after a top-up order marked as such
      paypalNote: reference
        ? [reference, ...(topUp ? [t`top-up`] : []), unitMembers.map(fullName).join(", ")].filter(Boolean).join(" · ").slice(0, 200)
        : null,
      payment: isOrder && b ? amountsOf(unit) : null,
    };
  });
  const order = { self: 0, family: 1, other: 2 };
  myUnits.sort((a, b) => order[a.who] - order[b.who] || compare(a.name, b.name));

  // Orders: totals and counts for managers only, participants see only their own order (README); the "results"
  // setting does not apply there
  const orderPrivate = isOrder && !manage;
  const resultsVisible = !orderPrivate && (manage || p.results === "always" || !open);
  // Names: managers unless anonymous; participants only for scheduling polls without "anonymous" (docs/dev/decisions.md)
  const names = anonymous ? null : manage ? "full" : p.kind === "schedule" ? "short" : null;
  let tallies: PollTally[] | null = null;
  if (resultsVisible) {
    const map = new Map<string, PollTally>();
    for (const [unit, items] of answersOf) {
      if (!ballotOf.has(unit)) continue;
      for (const a of items) {
        const k = `${a.optionId}|${a.size}|${isOrder ? 0 : a.value}`;
        const tally = map.get(k) ?? { optionId: a.optionId, size: a.size, value: isOrder ? 0 : a.value, units: 0, quantity: 0, names: names ? [] : undefined };
        tally.units += 1;
        tally.quantity += isOrder ? a.value : 1;
        if (tally.names) tally.names.push(label(unit, names === "full"));
        map.set(k, tally);
      }
    }
    tallies = [...map.values()];
    for (const tally of tallies) tally.names?.sort(compare);
  }

  const pending = manage && !anonymous ? [...units].filter((u) => !ballotOf.has(u)).map((u) => label(u, true)).sort(compare) : null;
  let orders: PollOrder[] | null = null;
  if (manage && isOrder) {
    orders = ballots
      .map((b) => {
        const amounts = amountsOf(b.unit_id);
        return {
          unitId: b.unit_id,
          orderNo: b.order_no,
          label: label(b.unit_id, true),
          items: (answersOf.get(b.unit_id) ?? []).map((a) => ({ optionId: a.optionId, size: a.size, quantity: a.value })),
          totalCents: amounts.totalCents,
          paid: paymentState(amounts).settled,
          paidCents: amounts.paidCents,
          reportedCents: amounts.reportedCents,
        };
      })
      .sort((x, y) => (x.orderNo ?? 0) - (y.orderNo ?? 0) || compare(x.label, y.label));
  }

  return {
    poll: {
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      teamId: p.team_id,
      teamName: team?.name ?? null,
      multiple: p.multiple === 1,
      anonymous,
      results: p.results,
      perFamily,
      whoPlayers: p.who_players === 1,
      whoParents: p.who_parents === 1,
      whoCoaches: p.who_coaches === 1,
      endsAt: p.ends_at,
      open,
      createdBy: creator ? fullName(creator) : null,
      createdAt: p.created_at,
      payment: isOrder ? pay : null,
      currency: pay.currency,
    },
    options,
    canManage: manage,
    canEdit: canEditPoll(actor, p),
    myUnits,
    voted: orderPrivate ? 0 : [...units].filter((u) => ballotOf.has(u)).length,
    total: orderPrivate ? 0 : units.size,
    resultsVisible,
    tallies,
    pending,
    orders,
  };
}

/** Polls the account sees: as a voter or manager. teamId: only this team (null: the whole club). */
export async function listPolls(db: D1Database, actor: Actor, filter: { teamId?: number | null } = {}): Promise<PollSummary[]> {
  const now = nowLocal();
  const rows = await all<PollRow & { team_name: string | null; open_units: number; ignored: number; voted: number | null; total: number | null }>(
    db,
    `SELECT p.*, t.name AS team_name,
            EXISTS (SELECT 1 FROM poll_ignores i WHERE i.poll_id = p.id AND i.person_id = ?1) AS ignored,
            (SELECT COUNT(DISTINCT pv.unit_id) FROM poll_voters pv
              WHERE pv.poll_id = p.id AND pv.person_id = ?1 AND pv.can_vote = 1
                AND NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = p.id AND b.unit_id = pv.unit_id)) AS open_units,
            -- The counts read every voter of the poll: only for managers, only they see them in the list
            CASE WHEN ?2 = 1 OR p.created_by = ?1 OR p.team_id IN (SELECT value FROM json_each(?3)) THEN
              (SELECT COUNT(*) FROM poll_ballots b WHERE b.poll_id = p.id AND b.unit_id IN (SELECT unit_id FROM poll_voters WHERE poll_id = p.id)) END AS voted,
            CASE WHEN ?2 = 1 OR p.created_by = ?1 OR p.team_id IN (SELECT value FROM json_each(?3)) THEN
              (SELECT COUNT(DISTINCT unit_id) FROM poll_voters WHERE poll_id = p.id) END AS total
       FROM polls p LEFT JOIN teams t ON t.id = p.team_id
      WHERE (?2 = 1 OR p.created_by = ?1
             OR p.team_id IN (SELECT value FROM json_each(?3))
             OR p.id IN (SELECT poll_id FROM poll_voters WHERE person_id = ?1 AND can_vote = 1))
        AND (?4 = 0 OR p.team_id IS ?5)
      ORDER BY (p.closed_at IS NULL AND p.ends_at > ?6) DESC, p.ends_at, p.id`,
    actor.personId,
    actor.isAdmin ? 1 : 0,
    list(actor.coachTeamIds),
    filter.teamId !== undefined ? 1 : 0,
    filter.teamId ?? null,
    now,
  );
  return rows.map((p) => {
    // How many voted: only for the creator, coaches of the team and admins (the list shows it only to them)
    const canManage = canManagePoll(actor, p);
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      teamId: p.team_id,
      teamName: p.team_name,
      endsAt: p.ends_at,
      open: isOpen(p, now),
      openUnits: p.open_units,
      ignored: !!p.ignored,
      voted: canManage ? (p.voted ?? 0) : 0,
      total: canManage ? (p.total ?? 0) : 0,
      canManage,
    };
  });
}

/**
 * Running polls where a vote of this person is missing and not ignored, for the cards on the start page and the dot
 * on the Events tab. Starts from the person's own voter rows (index poll_voters_person).
 */
export async function openPolls(db: D1Database, actor: Actor): Promise<PollSummary[]> {
  const rows = await all<{ id: number; kind: PollKind; title: string; team_id: number | null; team_name: string | null; ends_at: string; created_by: number | null; open_units: number }>(
    db,
    `SELECT p.id, p.kind, p.title, p.team_id, t.name AS team_name, p.ends_at, p.created_by, COUNT(DISTINCT pv.unit_id) AS open_units
       FROM poll_voters pv JOIN polls p ON p.id = pv.poll_id LEFT JOIN teams t ON t.id = p.team_id
      WHERE pv.person_id = ?1 AND pv.can_vote = 1 AND p.closed_at IS NULL AND p.ends_at > ?2
        AND NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = pv.poll_id AND b.unit_id = pv.unit_id)
        AND NOT EXISTS (SELECT 1 FROM poll_ignores i WHERE i.poll_id = pv.poll_id AND i.person_id = ?1)
      GROUP BY p.id ORDER BY p.ends_at, p.id`,
    actor.personId,
    nowLocal(),
  );
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    teamId: p.team_id,
    teamName: p.team_name,
    endsAt: p.ends_at,
    open: true,
    openUnits: p.open_units,
    ignored: false,
    voted: 0,
    total: 0,
    canManage: canManagePoll(actor, p),
  }));
}

/** For the app icon: running polls where this account's person still has to vote (ignored orders left out). */
export async function pollBadgeCount(db: D1Database, accountId: number, now: string): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT pv.poll_id) AS n
       FROM poll_voters pv JOIN polls p ON p.id = pv.poll_id
      WHERE pv.person_id = (SELECT person_id FROM accounts WHERE id = ?1) AND pv.can_vote = 1 AND p.closed_at IS NULL AND p.ends_at > ?2
        AND NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = pv.poll_id AND b.unit_id = pv.unit_id)
        AND NOT EXISTS (SELECT 1 FROM poll_ignores i WHERE i.poll_id = pv.poll_id AND i.person_id = pv.person_id)`,
    accountId,
    now,
  );
  return row?.n ?? 0;
}

// Notifications -----------------------------------------------------------------------------------

/** Accounts of the voters (unvotedOnly: only who has not voted or ignored yet); topic "polls" of the own person. */
export async function pollRecipients(db: D1Database, pollId: number, unvotedOnly: boolean): Promise<number[]> {
  const rows = await all<{ id: number }>(
    db,
    `SELECT DISTINCT a.id FROM poll_voters pv JOIN accounts a ON a.person_id = pv.person_id AND a.disabled_at IS NULL
      WHERE pv.poll_id = ?1 AND pv.can_vote = 1
        AND (?2 = 0 OR (NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = pv.poll_id AND b.unit_id = pv.unit_id)
                        AND NOT EXISTS (SELECT 1 FROM poll_ignores i WHERE i.poll_id = pv.poll_id AND i.person_id = pv.person_id)))
        AND NOT EXISTS (SELECT 1 FROM notification_settings ns
                         WHERE ns.account_id = a.id AND ns.person_id = a.person_id AND ns.topic = 'polls' AND ns.enabled = 0)`,
    pollId,
    unvotedOnly ? 1 : 0,
  );
  return rows.map((r) => r.id);
}

/** "Fri 2 Oct, 20:00" in the current language. */
export function endsLabel(endsAt: string): string {
  return `${shortDate(endsAt)}, ${shortTime(endsAt)}`;
}

/** Hourly: sync the voters of running polls (if teams or parent links changed), remind open voters a day before the end. */
export async function runPolls(env: Env, now = Date.now()): Promise<number> {
  const local = nowLocal(now);
  const polls = await all<PollRow & { team_name: string | null }>(
    env.DB,
    "SELECT p.*, t.name AS team_name FROM polls p LEFT JOIN teams t ON t.id = p.team_id WHERE p.closed_at IS NULL AND p.ends_at > ?",
    local,
  );
  if (!polls.length) return 0;
  const versions = await voterVersions(env.DB);
  let sent = 0;
  for (const p of polls) {
    await syncVoters(env.DB, p, versions);
    // Reminder 24 hours before the end, not for polls that run shorter than a day
    const createdLocal = nowLocal(Date.parse(p.created_at));
    if (p.reminded_at || p.ends_at > addMinutesLocal(local, 24 * 60) || addMinutesLocal(createdLocal, 24 * 60) > local) continue;
    await run(env.DB, "UPDATE polls SET reminded_at = ? WHERE id = ?", utcIso(now), p.id);
    const team = p.team_name;
    const title = p.title;
    sent += await enqueuePush(env, await pollRecipients(env.DB, p.id, true), () => {
      const ends = endsLabel(p.ends_at);
      return {
        title: team ? t`Poll ends soon · ${team}` : t`Poll ends soon`,
        body: t`${title} · until ${ends}`,
        url: `/umfragen/${p.id}`,
        tag: `poll-${p.id}`,
      };
    });
  }
  return sent;
}
