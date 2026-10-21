// Restoring from Kabine's own export (Administration → Export): the admin ticks what to take over. Everything is
// merged, nothing is deleted: rows that exist already are kept and skipped. Ticking everything on an empty
// installation is a full restore. Used by the app (src/restore.tsx) and the worker (worker/routes/restore.ts).

export const RESTORE_CATEGORIES = ["club", "season", "teams", "people", "memberships", "plans", "events", "chats"] as const;
export type RestoreCategory = (typeof RESTORE_CATEGORIES)[number];

/** Tables per category, in the order they are restored. Tables of modules are listed with their category. */
export const RESTORE_TABLES: Record<Exclude<RestoreCategory, "club">, readonly string[]> = {
  season: ["seasons", "age_classes", "holiday_periods", "public_holidays"],
  teams: ["teams"],
  people: ["persons", "accounts", "guardianships", "child_permissions", "child_permission_log", "club_members", "notification_settings", "notification_channels", "avatars"],
  memberships: ["team_memberships", "core_squad", "referees"],
  plans: ["locations", "training_plans", "training_rules", "rule_teams", "standing_absences"],
  events: [
    "events",
    "event_teams",
    "event_organizers",
    "responses",
    "nominations",
    "help_requests",
    "unexcused_absences",
    "attendance_marks",
    "attendance",
    "season_stats",
    "leader_absences",
    "duty_types",
    "duty_templates",
    "duty_template_items",
    "event_duties",
    "duties",
    "skill_consents",
    "duty_notifications",
    "carpool_offers",
    "carpool_requests",
  ],
  chats: ["chat_optouts", "chat_mutes", "chat_state", "chat_reads", "chat_mentions"],
};

/** A category needs these to be taken over too (their rows are what its rows point to). */
export const RESTORE_NEEDS: Record<RestoreCategory, readonly RestoreCategory[]> = {
  club: [],
  season: [],
  teams: ["season"],
  people: [],
  memberships: ["teams", "people"],
  plans: ["teams", "people"],
  events: ["teams", "people", "plans"],
  chats: ["teams", "people"],
};

/** The categories with everything they need. */
export function withNeeds(chosen: Iterable<RestoreCategory>): Set<RestoreCategory> {
  const out = new Set<RestoreCategory>();
  const add = (c: RestoreCategory) => {
    if (out.has(c)) return;
    out.add(c);
    RESTORE_NEEDS[c].forEach(add);
  };
  for (const c of chosen) add(c);
  return out;
}

/** The export file as Administration → Export writes it. */
export interface KabineExport {
  app: "Kabine";
  exportedAt: string;
  /** Kabine version that wrote it (missing in exports before 0.3) */
  version?: string;
  data: Record<string, unknown> & {
    app_meta?: { key: string; value: string }[];
    chats?: Record<string, ExportedChat | null>;
  };
}

export interface ExportedChat {
  messages: { id: number; kind: string; person_id: number | null; text: string; created_at: string; deleted_at: string | null }[];
  authors: { person_id: number; name: string; label: string | null; is_former: number }[];
  reactions: { message_id: number; person_id: number; emoji: string; created_at: string }[];
}

/** The file is a Kabine export, or the reason why not. */
export function checkExport(value: unknown): KabineExport | string {
  const v = value as Partial<KabineExport> | null;
  if (!v || typeof v !== "object" || v.app !== "Kabine" || !v.data || typeof v.data !== "object") return "not_kabine";
  return v as KabineExport;
}

/** Rows per table in the file, for the counts next to the checkboxes. */
export function rowCount(file: KabineExport, table: string): number {
  const rows = file.data[table];
  return Array.isArray(rows) ? rows.length : 0;
}

/** Old ids of one table → new ids in this installation, per table. */
export type IdMaps = Record<string, Record<string, number>>;

/** What the restore of one chunk of rows did. */
export interface RestoreChunkResult {
  /** old id → new id, for tables with an id column (new and existing rows) */
  ids: Record<string, number>;
  added: number;
  existing: number;
  skipped: number;
}

/** A reference that pointed to a row restored later (teams → duty templates); set in a last pass. */
export interface RestoreFixup {
  table: string;
  where: Record<string, string | number | null>;
  column: string;
  refTable: string;
  old: number;
}

export type RestoreTally = Record<RestoreCategory, { added: number; existing: number; skipped: number }>;

export type RestoreProgress = { category: RestoreCategory; done: number; total: number } | { category: "chats"; chat: string };

/** Rows per request: small enough for the CPU limit of a Worker, pictures fewer because of their size. */
const chunkSize = (table: string) => (table === "avatars" ? 20 : 200);

/**
 * The whole restore, as the app runs it against worker/routes/restore.ts: the ticked categories table by table in
 * chunks, collecting the new ids, then the late references, the chats (into empty rooms) and the club settings.
 */
export async function runRestore(
  file: KabineExport,
  chosen: Set<RestoreCategory>,
  post: <T>(path: string, body: unknown) => Promise<T>,
  progress: (p: RestoreProgress) => void = () => undefined,
): Promise<RestoreTally> {
  const maps: IdMaps = {};
  const fixups: RestoreFixup[] = [];
  // Admin roles only with a full restore: people from another club's export do not become admins here
  const keepAdmins = RESTORE_CATEGORIES.every((c) => chosen.has(c));
  const tally = Object.fromEntries(RESTORE_CATEGORIES.map((c) => [c, { added: 0, existing: 0, skipped: 0 }])) as RestoreTally;
  for (const c of RESTORE_CATEGORIES) {
    if (!chosen.has(c) || c === "club") continue;
    for (const table of RESTORE_TABLES[c]) {
      const rows = (file.data[table] as Record<string, unknown>[] | undefined) ?? [];
      // Chats are counted by room below, their tables here are read markers and mutes
      const main = c !== "chats" && table === RESTORE_TABLES[c][0];
      for (let i = 0; i < rows.length; i += chunkSize(table)) {
        if (main) progress({ category: c, done: i, total: rows.length });
        const res = await post<RestoreChunkResult & { fixups: RestoreFixup[] }>("/admin/restore/rows", { table, rows: rows.slice(i, i + chunkSize(table)), maps, keepAdmins });
        maps[table] = { ...maps[table], ...res.ids };
        fixups.push(...res.fixups);
        // The counts are those of the category's main table (people, events, …); skipped rows count everywhere
        if (main) {
          tally[c].added += res.added;
          tally[c].existing += res.existing;
        }
        tally[c].skipped += res.skipped;
      }
    }
  }
  for (let i = 0; i < fixups.length; i += 2000) await post("/admin/restore/fixups", { fixups: fixups.slice(i, i + 2000), maps });
  if (chosen.has("chats")) {
    const teams = (file.data.teams as { id: number; name: string }[] | undefined) ?? [];
    for (const [name, chat] of Object.entries(file.data.chats ?? {})) {
      const old = teams.find((x) => x.name === name)?.id;
      const teamId = old != null ? maps.teams?.[String(old)] : undefined;
      if (!chat?.messages.length || teamId == null) continue;
      progress({ category: "chats", chat: name });
      const res = await post<{ imported: number }>("/admin/restore/chat", { teamId, chat, persons: maps.persons ?? {} });
      if (res.imported) tally.chats.added++;
      else tally.chats.existing++;
    }
  }
  const club = file.data.app_meta?.find((m) => m.key === "club");
  if (chosen.has("club") && club) {
    await post("/admin/restore/club", { value: club.value, persons: maps.persons ?? {} });
    tally.club.added = 1;
  }
  return tally;
}
