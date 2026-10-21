// Restore from Kabine's own export (shared/restore.ts): the browser sends the rows table by table in small chunks
// (so each request stays within the Workers CPU limit), with the id maps of what it sent before. Every row gets a
// new id; its references are mapped to the new ids. Rows that exist already are kept and only mapped. Nothing is
// deleted or overwritten. The schema is read from the database, so exports of older versions fit: columns that no
// longer exist are dropped, new ones take their defaults.
import { t } from "@lingui/core/macro";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireActor } from "../app";
import { requireAdmin } from "../auth/actor";
import { chatStub } from "../domain/chat";
import { loadClub, saveClub } from "../domain/club";
import { all, batch, first, stmt, type Param } from "../lib/db";
import { badRequest, parse, readJson } from "../lib/http";
import { randomToken } from "../lib/crypto";
import { nameKey } from "../../shared/list-import";
import { type ExportedChat, type IdMaps, RESTORE_TABLES, type RestoreChunkResult } from "../../shared/restore";

export const restoreRoutes = new Hono<AppEnv>();

const TABLES = new Set(Object.values(RESTORE_TABLES).flat());
/** Not compared when looking for a row that exists already: they differ between two copies of the same row. */
const VOLATILE = new Set(["created_at", "updated_at"]);

interface Column {
  name: string;
  notnull: boolean;
  hasDefault: boolean;
  pk: number;
  type: string;
}
interface Schema {
  columns: Column[];
  names: Set<string>;
  /** The table has an INTEGER PRIMARY KEY "id" (rows get new ids) */
  idTable: boolean;
  fks: { from: string; table: string; notnull: boolean }[];
  /** Column sets that are unique (also partial indexes, used where all their columns have a value) */
  unique: string[][];
}

async function schemaOf(db: D1Database, table: string): Promise<Schema> {
  const cols = await all<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>(db, `PRAGMA table_info(${table})`);
  const fks = await all<{ from: string; table: string }>(db, `PRAGMA foreign_key_list(${table})`);
  const indexes = await all<{ name: string; unique: number; origin: string; partial: number }>(db, `PRAGMA index_list(${table})`);
  const unique: string[][] = [];
  // "Only one current season" is a rule, not an identity: never used to find a row
  for (const ix of indexes.filter((i) => i.unique && i.origin !== "pk" && i.name !== "seasons_single_current")) {
    unique.push((await all<{ name: string }>(db, `PRAGMA index_info(${JSON.stringify(ix.name)})`)).map((c) => c.name));
  }
  const columns = cols.map((c) => ({ name: c.name, notnull: c.notnull === 1, hasDefault: c.dflt_value != null, pk: c.pk, type: c.type.toUpperCase() }));
  const notnull = new Set(columns.filter((c) => c.notnull).map((c) => c.name));
  return {
    columns,
    names: new Set(columns.map((c) => c.name)),
    idTable: columns.some((c) => c.name === "id" && c.pk === 1 && c.type === "INTEGER") && columns.filter((c) => c.pk).length === 1,
    fks: fks.map((f) => ({ from: f.from, table: f.table, notnull: notnull.has(f.from) })),
    unique,
  };
}

function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));

/** A later pass sets a reference that pointed to a row not restored yet (teams → duty templates, …). */
interface Fixup {
  table: string;
  /** Primary key of the row in this installation */
  where: Record<string, Param>;
  column: string;
  refTable: string;
  old: number;
}

const rowsSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())).max(500),
  maps: z.record(z.string(), z.record(z.string(), z.number())),
  /** Full restore: admin roles come along. Otherwise imported people never become admins here. */
  keepAdmins: z.boolean().default(false),
});

restoreRoutes.post("/admin/restore/rows", async (c) => {
  requireAdmin(requireActor(c));
  const { table, rows, maps, keepAdmins } = parse(rowsSchema, await readJson(c.req.raw));
  if (!TABLES.has(table)) throw badRequest(t`This part of the export cannot be restored.`, "restore_table");
  const db = c.env.DB;
  const schema = await schemaOf(db, table);
  if (!schema.columns.length) return c.json({ ids: {}, added: 0, existing: 0, skipped: rows.length, fixups: [] });
  const result: RestoreChunkResult & { fixups: Fixup[] } = { ids: {}, added: 0, existing: 0, skipped: 0, fixups: [] };

  // Each row with mapped references and only the columns this version has
  const prepared: { old: number | null; values: Record<string, Param>; pending: { column: string; refTable: string; old: number }[] }[] = [];
  for (const row of rows) {
    const values: Record<string, Param> = {};
    for (const col of schema.columns) {
      if (!(col.name in row)) continue;
      if (schema.idTable && col.name === "id") continue;
      const v = row[col.name];
      values[col.name] = v == null ? null : typeof v === "object" ? JSON.stringify(v) : (v as Param);
    }
    const pending: { column: string; refTable: string; old: number }[] = [];
    let missing = false;
    for (const fk of schema.fks) {
      const v = values[fk.from];
      if (v == null) continue;
      const mapped = maps[fk.table]?.[String(v)];
      if (mapped != null) values[fk.from] = mapped;
      else if (fk.notnull) missing = true;
      else {
        values[fk.from] = null;
        pending.push({ column: fk.from, refTable: fk.table, old: Number(v) });
      }
    }
    if (missing) {
      result.skipped++;
      continue;
    }
    prepared.push({ old: schema.idTable ? Number(row.id) : null, values, pending });
  }
  await special(db, table, prepared);
  if (table === "persons" && !keepAdmins) {
    for (const p of prepared) {
      p.values.is_admin = 0;
      p.values.admin_email = null;
    }
  }
  // Required columns without a value (an export of an older version): such rows cannot be restored
  const complete = prepared.filter((p) => !schema.columns.some((col) => col.notnull && !col.hasDefault && !col.pk && p.values[col.name] == null));
  result.skipped += prepared.length - complete.length;
  prepared.splice(0, prepared.length, ...complete);

  // Rows that exist already: by a unique value, for persons by name and birth year, otherwise by the same content
  const existing = schema.idTable ? await existingIds(db, table, schema, prepared) : new Map<number, number>();
  const inserts: { index: number; statement: D1PreparedStatement }[] = [];
  prepared.forEach((p, index) => {
    const found = existing.get(index);
    if (found != null) {
      result.ids[String(p.old)] = found;
      result.existing++;
      return;
    }
    const names = Object.keys(p.values);
    const sql = `INSERT OR IGNORE INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})${schema.idTable ? " RETURNING id" : ""}`;
    inserts.push({ index, statement: stmt(db, sql, ...names.map((n) => p.values[n])) });
  });
  const res = await batch(db, inserts.map((i) => i.statement));
  inserts.forEach(({ index }, n) => {
    const p = prepared[index]!;
    const r = res[n]!;
    if (!r.meta.changes) {
      // Composite keys: the same row is there already
      result.existing++;
      return;
    }
    result.added++;
    const where: Record<string, Param> = {};
    if (schema.idTable) {
      const id = (r.results[0] as { id: number }).id;
      result.ids[String(p.old)] = id;
      where.id = id;
    } else for (const col of schema.columns.filter((x) => x.pk)) where[col.name] = p.values[col.name] ?? null;
    for (const f of p.pending) result.fixups.push({ table, where, ...f });
  });
  return c.json(result);
});

/** Table-specific rules before inserting. */
async function special(db: D1Database, table: string, rows: { values: Record<string, Param> }[]): Promise<void> {
  if (table === "accounts") {
    // The passkey handle is not in the export: a new one; passkeys are set up again
    for (const r of rows) r.values.webauthn_user_id = randomToken(16);
  }
  if (table === "avatars") {
    for (const r of rows) if (typeof r.values.image === "string") r.values.image = base64ToBytes(r.values.image);
  }
  if (table === "seasons") {
    // Only one current season: an installation that has one keeps it
    const current = await first(db, "SELECT 1 AS ok FROM seasons WHERE is_current = 1");
    if (current) for (const r of rows) r.values.is_current = 0;
  }
}

async function existingIds(db: D1Database, table: string, schema: Schema, rows: { values: Record<string, Param> }[]): Promise<Map<number, number>> {
  const found = new Map<number, number>();
  if (!rows.length) return found;
  if (table === "persons") {
    // As in the list import: the same name (umlauts and case aside), and the birth year matches or is missing
    const known = await all<{ id: number; first_name: string; last_name: string | null; birth_year: number | null; admin_email: string | null }>(
      db,
      "SELECT id, first_name, last_name, birth_year, admin_email FROM persons",
    );
    rows.forEach((r, i) => {
      const v = r.values;
      const key = `${nameKey(String(v.first_name ?? ""))}|${nameKey(String(v.last_name ?? ""))}`;
      const match =
        known.find((k) => v.admin_email != null && k.admin_email === v.admin_email) ??
        known.find((k) => `${nameKey(k.first_name)}|${nameKey(k.last_name ?? "")}` === key && (k.birth_year == null || v.birth_year == null || same(k.birth_year, v.birth_year)));
      if (match) found.set(i, match.id);
    });
    return found;
  }
  // Unique values first (team name, age class code, duty type code, fixture game, one account per person)
  for (const cols of schema.unique) {
    const open = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => !found.has(i) && cols.every((c) => r.values[c] != null));
    if (!open.length || cols.includes("webauthn_user_id")) continue;
    const lead = cols[0]!;
    const candidates = await all<Record<string, unknown> & { id: number }>(
      db,
      `SELECT id, ${cols.join(", ")} FROM ${table} WHERE ${lead} IN (SELECT value FROM json_each(?))`,
      JSON.stringify([...new Set(open.map(({ r }) => r.values[lead]))]),
    );
    for (const { r, i } of open) {
      const hit = candidates.find((k) => cols.every((c) => same(k[c], r.values[c])));
      if (hit) found.set(i, hit.id);
    }
  }
  // No unique value: the same content apart from id and timestamps. Candidates by the most telling required column.
  const compare = schema.columns.filter((c) => c.name !== "id" && !VOLATILE.has(c.name)).map((c) => c.name);
  const open = rows.map((r, i) => ({ r, i })).filter(({ i }) => !found.has(i));
  if (!open.length) return found;
  const leads = schema.columns.filter((c) => c.notnull && c.name !== "id" && !VOLATILE.has(c.name)).map((c) => c.name);
  const lead = leads.sort((a, b) => new Set(open.map(({ r }) => r.values[b])).size - new Set(open.map(({ r }) => r.values[a])).size)[0];
  const candidates = lead
    ? await all<Record<string, unknown> & { id: number }>(
        db,
        `SELECT * FROM ${table} WHERE ${lead} IN (SELECT value FROM json_each(?))`,
        JSON.stringify([...new Set(open.map(({ r }) => r.values[lead]))]),
      )
    : await all<Record<string, unknown> & { id: number }>(db, `SELECT * FROM ${table}`);
  for (const { r, i } of open) {
    const hit = candidates.find((k) => compare.every((c) => !(c in r.values) || same(k[c], r.values[c])));
    if (hit) found.set(i, hit.id);
  }
  return found;
}

const fixupSchema = z.object({
  fixups: z
    .array(z.object({ table: z.string(), where: z.record(z.string(), z.union([z.string(), z.number(), z.null()])), column: z.string(), refTable: z.string(), old: z.number() }))
    .max(2000),
  maps: z.record(z.string(), z.record(z.string(), z.number())),
});

/** The references that pointed to rows restored later. */
restoreRoutes.post("/admin/restore/fixups", async (c) => {
  requireAdmin(requireActor(c));
  const { fixups, maps } = parse(fixupSchema, await readJson(c.req.raw));
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [];
  const schemas = new Map<string, Schema>();
  for (const f of fixups) {
    if (!TABLES.has(f.table)) continue;
    const schema = schemas.get(f.table) ?? (await schemaOf(db, f.table));
    schemas.set(f.table, schema);
    const id = maps[f.refTable]?.[String(f.old)];
    if (id == null || !schema.fks.some((fk) => fk.from === f.column && fk.table === f.refTable)) continue;
    const keys = Object.keys(f.where).filter((k) => schema.names.has(k));
    if (!keys.length) continue;
    statements.push(stmt(db, `UPDATE ${f.table} SET ${f.column} = ? WHERE ${keys.map((k) => `${k} IS ?`).join(" AND ")}`, id, ...keys.map((k) => f.where[k]!)));
  }
  const res = await batch(db, statements);
  return c.json({ updated: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) });
});

const chatSchema = z.object({
  teamId: z.number().int().positive(),
  chat: z.object({
    messages: z.array(z.record(z.string(), z.unknown())).max(20000),
    authors: z.array(z.record(z.string(), z.unknown())).max(5000),
    reactions: z.array(z.record(z.string(), z.unknown())).max(50000),
  }),
  persons: z.record(z.string(), z.number()),
});

/** The chat history of one team, into its room if the room is still empty. */
restoreRoutes.post("/admin/restore/chat", async (c) => {
  requireAdmin(requireActor(c));
  const { teamId, chat, persons } = parse(chatSchema, await readJson(c.req.raw));
  if (!(await first(c.env.DB, "SELECT 1 AS ok FROM teams WHERE id = ?", teamId))) throw badRequest(t`This team does not exist.`);
  const res = await chatStub(c.env, teamId).fetch("https://chat.internal/import", {
    method: "POST",
    headers: { "x-team-id": String(teamId), "content-type": "application/json" },
    body: JSON.stringify({ chat: chat as unknown as ExportedChat, persons }),
  });
  return c.json((await res.json()) as { imported: number });
});

const clubSchema = z.object({ value: z.string().max(2_000_000), persons: z.record(z.string(), z.number()) });

/** Club profile: name, colours, logo, region, modules. The owner of this installation stays. */
restoreRoutes.post("/admin/restore/club", async (c) => {
  requireAdmin(requireActor(c));
  const { value, persons } = parse(clubSchema, await readJson(c.req.raw));
  let imported: Record<string, unknown>;
  try {
    imported = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw badRequest(t`The club settings in the export cannot be read.`);
  }
  const current = await loadClub(c.env.DB);
  const oldOwner = typeof imported.ownerPersonId === "number" ? persons[String(imported.ownerPersonId)] : undefined;
  delete imported.ownerPersonId;
  await saveClub(c.env.DB, { ...(imported as object), ownerPersonId: current.ownerPersonId ?? oldOwner ?? null });
  return c.json({ ok: true });
});
