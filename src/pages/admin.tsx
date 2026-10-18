import { useLocation } from "preact-iso";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { LocationRef, PersonRef } from "../../shared/types";
import { api } from "../api";
import { clubName, useClub } from "../club";
import { daysBetween, fullDate, isoToLocalDate, personName, todayLocal } from "../format";
import { downloadExport } from "../export";
import { ExtraEventList } from "../extra-events";
import { AdminAvatar, PersonAvatar } from "../avatar";
import { Icon, type IconName } from "../icons";
import { useMe, useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, copyText, Empty, ErrorBox, Field, Notice, Segmented, Sheet, shareLink, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { QrLink } from "./team";
import { roleLabel } from "./group";

export function AdminOnly({ children }: { children: preact.ComponentChildren }) {
  const me = useMe();
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title="Verwaltung" back="/" />
        <div class="content">
          <Notice kind="warn">Dieser Bereich ist nur für Admins.</Notice>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

export function AdminPage() {
  useDocumentTitle("Verwaltung");
  const me = useMe();
  const club = useClub();
  const teamsQuery = useQuery<{ teams: { id: number; name: string; kind: "team" | "group"; players: number; coaches: number }[] }>("/teams");
  const teams = { ...teamsQuery, data: teamsQuery.data && { teams: teamsQuery.data.teams.filter((t) => t.kind === "team") } };
  const groupCount = (teamsQuery.data?.teams ?? []).filter((t) => t.kind === "group").length;
  const coaching = new Set(me.memberships.filter((m) => m.role === "coach").map((m) => m.id));
  const own = (teamsQuery.data?.teams ?? []).filter((t) => coaching.has(t.id));
  const items: { href: string; icon: IconName; title: string; sub: string; download?: boolean }[] = [
    {
      href: "/verwaltung/mannschaften",
      icon: "users",
      title: "Mannschaften",
      sub: teams.data
        ? `${teams.data.teams.length === 1 ? "1 Mannschaft" : `${teams.data.teams.length} Mannschaften`} · Kader öffnen, anlegen, Trainer zuordnen`
        : "Kader öffnen, anlegen, Trainer zuordnen",
    },
    {
      href: "/verwaltung/gruppen",
      icon: "chat",
      title: "Gruppen",
      sub: `${groupCount ? `${groupCount === 1 ? "1 Gruppe" : `${groupCount} Gruppen`} · ` : ""}Nur Chat und Sondertermine, z. B. Trainerteam`,
    },
    { href: "/verwaltung/personen", icon: "user", title: "Personen", sub: "Alle Mitglieder, Admins, Zugangslinks" },
    { href: "/verwaltung/altersklassen", icon: "calendar", title: "Altersklassen", sub: "Jahrgänge der laufenden Saison" },
    { href: "/verwaltung/ferien", icon: "sun", title: "Ferien", sub: "Zeiträume bearbeiten (z. B. Fastnacht)" },
    { href: "/verwaltung/orte", icon: "pin", title: "Trainingsorte", sub: "Vereinshallen und weitere Orte" },
    { href: "/verwaltung/rundnachricht", icon: "bell", title: "Rundnachricht", sub: "Ankündigung in alle oder ausgewählte Mannschaftschats" },
    { href: "/verwaltung/helferdienste", icon: "helping", title: "Helferdienste", sub: "Dienstarten und Vorlagen für Spiele und Sondertermine" },
    { href: "/verwaltung/kihasl", icon: "whistle", title: "KiHaSL/JuHaSL", sub: "Schiedsrichter-Rolle per Link vergeben, Liste" },
    { href: "/chat?alle", icon: "chat", title: "Alle Chats", sub: "Mannschaftschats, in denen du nicht Trainer oder Elternteil bist" },
    { href: "/verwaltung/sondertermine", icon: "calendar", title: "Sondertermine und Spiele", sub: "Kommende Termine anderer Mannschaften, Sondertermin anlegen" },
    { href: "/verwaltung/verein", icon: "settings", title: "Verein", sub: "Name, Farben, Logo, Datenschutz" },
    { href: "/verwaltung/saisonwechsel", icon: "refresh", title: "Saisonwechsel", sub: "Einmal im Jahr, mit Vorschau" },
    { href: "/api/admin/export", icon: "download", title: "Export", sub: "Alle Daten als JSON-Datei, zur Datensicherung", download: true },
    { href: "/hilfe", icon: "info", title: "Hilfe und Feedback", sub: "Rückmeldung zur App schicken" },
  ];
  return (
    <AdminOnly>
      <main class="page">
        <header class="hero">
          <div class="kicker">Verwaltung</div>
          <h1>{club.name}</h1>
          <div class="hero-sub">Angemeldet als Admin {me.person.firstName}</div>
        </header>
        <div class="content">
          {/* Nur eigene Mannschaften als Abkürzung, alle übrigen unter Verwaltung → Mannschaften */}
          {own.length ? (
            <section class="stack-sm" aria-label="Meine Mannschaften">
              <h2 class="section-title">Meine Mannschaften</h2>
              <ul class="list">
                {own.map((t) => (
                  <li>
                    <a class="list-row" href={`/team/${t.id}`}>
                      <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                        {t.name}
                      </span>
                      <span class="main">
                        <span class="sub">
                          {t.players} Spieler · {t.coaches} Trainer
                        </span>
                      </span>
                      <Icon name="chevron" size={18} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {teams.error ? <ErrorBox error={teams.error} /> : null}
          <ul class="list" aria-label="Verwaltung">
            {items.map((i) => (
              <li>
                {i.download ? (
                  // Knopf statt Link: der Router würde den Link abfangen, erst kommt der Datenschutzhinweis
                  <button type="button" class="list-row" onClick={() => void downloadExport()}>
                    <Icon name={i.icon} size={22} />
                    <span class="main">
                      <span class="title">{i.title}</span>
                      <span class="sub">{i.sub}</span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                ) : (
                  <a class="list-row" href={i.href}>
                    <Icon name={i.icon} size={22} />
                    <span class="main">
                      <span class="title">{i.title}</span>
                      <span class="sub">{i.sub}</span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </AdminOnly>
  );
}

// Rundnachricht -----------------------------------------------------------------------

export function AdminBroadcastPage() {
  useDocumentTitle("Rundnachricht");
  const teams = useQuery<{ teams: { id: number; name: string; players: number }[] }>("/teams");
  const [text, setText] = useState("");
  const [all, setAll] = useState(true);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = teams.data?.teams ?? [];
  const count = all ? list.length : teamIds.length;
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Rundnachricht" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          <p class="muted">Erscheint als hervorgehobene Ankündigung im Chat jeder gewählten Mannschaft, mit deinem Namen.</p>
          <Field label="Nachricht">
            {(fid) => <textarea id={fid} class="textarea" rows={5} value={text} maxLength={2000} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="z. B. Einladung zum Saisonabschluss am …" />}
          </Field>
          <ul class="list">
            <li>
              <SwitchRow label="An alle Mannschaften" sub={`${list.length} Mannschaftschats`} checked={all} onChange={setAll} />
            </li>
          </ul>
          {!all ? (
            <div class="field" role="group" aria-label="Mannschaften">
              <span class="field-label">Mannschaften</span>
              <span class="field-hint">Mehrere möglich</span>
              <div class="chips">
                {list.map((t) => (
                  <button
                    type="button"
                    class={`chip ${teamIds.includes(t.id) ? "selected" : ""}`}
                    aria-pressed={teamIds.includes(t.id) ? "true" : "false"}
                    onClick={() => setTeamIds(teamIds.includes(t.id) ? teamIds.filter((x) => x !== t.id) : [...teamIds, t.id])}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <ul class="list">
            <li>
              <SwitchRow
                label="Alle sofort benachrichtigen"
                sub={
                  notify
                    ? "Jede Person im Chat, auch Eltern, bekommt sofort eine Benachrichtigung und die Zahl am App-Icon zählt hoch (wie bei @alle)."
                    : "Wie eine normale Chatnachricht: gebündelte Chat-Benachrichtigung für alle, die sie eingeschaltet haben."
                }
                checked={notify}
                onChange={setNotify}
              />
            </li>
          </ul>
          <Button
            variant="primary"
            size="lg"
            icon="send"
            disabled={busy || !text.trim() || !count}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Rundnachricht senden?",
                message: `Die Ankündigung erscheint in ${count === 1 ? "einem Mannschaftschat" : `${count} Mannschaftschats`}${notify ? " und alle werden sofort benachrichtigt" : ""}.`,
                confirmLabel: "Senden",
              });
              if (!ok) return;
              setBusy(true);
              try {
                const res = await api.post<{ sent: number }>("/admin/broadcast", { teamIds: all ? [] : teamIds, text: text.trim(), notify });
                toast(`Gesendet an ${res.sent === 1 ? "einen Chat" : `${res.sent} Chats`}.`);
                setText("");
                invalidate("/chat/rooms");
              } finally {
                setBusy(false);
              }
            }}
          >
            {count ? `An ${count === 1 ? "einen Chat" : `${count} Chats`} senden` : "Mannschaften wählen"}
          </Button>
        </div>
      </main>
    </AdminOnly>
  );
}

// Mannschaften ------------------------------------------------------------------------

interface AgeClass {
  code: string;
  name: string;
  gender: "w" | "m" | "x";
  rank: number;
  isYouth: boolean;
  birthYearMin: number | null;
  birthYearMax: number | null;
}

interface AdminPerson {
  person: PersonRef;
  birthYear: number | null;
  isActive: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  hasAccount: boolean;
  isReferee: boolean;
  isClubMember: boolean;
  /** Letzte Aktivität des Zugangs (lokales Datum), null = nie benutzt oder kein Zugang. */
  lastSeenOn: string | null;
  teams: { name: string; role: string; isGroup: boolean }[];
  children: string | null;
  /** Mannschaften der Kinder (Eltern). */
  childTeams: string[];
  childIds: number[];
  parentIds: number[];
}

type RoleFilter = "all" | "player" | "coach" | "parent" | "none";
type ActivityFilter = "" | "stale" | "never" | "noaccount";
type SortOrder = "name" | "activity";

/** Ab so vielen Tagen ohne Aktivität gilt ein Zugang im Filter als verwaist. */
const STALE_DAYS = 60;

function daysSinceSeen(p: AdminPerson): number | null {
  return p.lastSeenOn ? daysBetween(p.lastSeenOn, todayLocal()) : null;
}

/** „heute aktiv“, „vor 12 Tagen aktiv“, „Zugang nie benutzt“, „kein Zugang“ */
export function activityLabel(p: Pick<AdminPerson, "hasAccount" | "lastSeenOn">): string {
  if (!p.hasAccount) return "kein Zugang";
  if (!p.lastSeenOn) return "Zugang nie benutzt";
  const days = daysBetween(p.lastSeenOn, todayLocal());
  if (days <= 0) return "heute aktiv";
  if (days === 1) return "gestern aktiv";
  if (days < 45) return `vor ${days} Tagen aktiv`;
  if (days < 365) return `vor ${Math.round(days / 30)} Monaten aktiv`;
  return "vor über einem Jahr aktiv";
}

/** Sortierung „Zuletzt aktiv“: nie benutzte Zugänge, dann am längsten inaktiv, Personen ohne Zugang am Ende. */
function activityRank(p: AdminPerson): number {
  if (!p.hasAccount) return -1;
  const days = daysSinceSeen(p);
  return days == null ? Number.MAX_SAFE_INTEGER : days;
}

/** Weder Mannschaft noch Kind noch Admin- oder KiHaSL-Rolle: Kandidaten zum Aufräumen. */
function withoutRole(p: AdminPerson): boolean {
  return !p.teams.length && !p.childIds.length && !p.isAdmin && !p.isReferee;
}
const NONE = "__none__";

export function AdminTeamsPage() {
  useDocumentTitle("Mannschaften");
  const { refresh } = useSession();
  const teams = useQuery<{
    teams: { id: number; name: string; kind: "team" | "group"; ageClassCode: string; level: number; parentsEnabled: boolean; players: number; coaches: number }[];
  }>("/teams");
  const ages = useQuery<{ ageClasses: AgeClass[] }>("/age-classes");
  const [edit, setEdit] = useState<{ id?: number; name: string; ageClassCode: string; level: number; parentsEnabled: boolean; wasEnabled?: boolean } | null>(
    null,
  );
  const isYouth = (code: string) => ages.data?.ageClasses.find((a) => a.code === code)?.isYouth ?? true;
  const [coachesFor, setCoachesFor] = useState<{ id: number; name: string } | null>(null);

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Mannschaften" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              const code = ages.data?.ageClasses[0]?.code ?? "";
              setEdit({ name: "", ageClassCode: code, level: 1, parentsEnabled: isYouth(code) });
            }}
          >
            Mannschaft anlegen
          </Button>
          {teams.error ? <ErrorBox error={teams.error} /> : null}
          <p class="small muted">
            Für Kreise ohne Training und Spiele, etwa das Trainerteam, gibt es <a href="/verwaltung/gruppen">Gruppen</a>.
          </p>
          <ul class="list">
            {(teams.data?.teams ?? []).filter((t) => t.kind === "team").map((t) => (
              <li>
                <div class="list-row">
                  <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                    {t.name}
                  </span>
                  <span class="main">
                    <span class="title">{ages.data?.ageClasses.find((a) => a.code === t.ageClassCode)?.name ?? t.ageClassCode}</span>
                    <span class="sub">
                      {t.level}. Mannschaft · {t.players} Spieler · {t.coaches} Trainer{t.parentsEnabled ? "" : " · ohne Eltern"}
                    </span>
                  </span>
                </div>
                <div class="btn-row" style={{ padding: "0 14px 12px" }}>
                  <a class="btn btn-sm" href={`/team/${t.id}`}>
                    Öffnen
                  </a>
                  <Button size="sm" onClick={() => setCoachesFor({ id: t.id, name: t.name })}>
                    Trainer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEdit({ id: t.id, name: t.name, ageClassCode: t.ageClassCode, level: t.level, parentsEnabled: t.parentsEnabled, wasEnabled: t.parentsEnabled })
                    }
                  >
                    Bearbeiten
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {edit ? (
          <Sheet open onClose={() => setEdit(null)} title={edit.id ? "Mannschaft bearbeiten" : "Neue Mannschaft"}>
            <TextField label="Name" value={edit.name} onInput={(v) => setEdit({ ...edit, name: v })} maxLength={30} hint="z. B. wC1, wC2, Damen 2" />
            <Field label="Altersklasse">
              {(id) => (
                <select
                  id={id}
                  class="select"
                  value={edit.ageClassCode}
                  onChange={(e) => {
                    const code = (e.target as HTMLSelectElement).value;
                    // Neue Mannschaften: Jugend mit Eltern, Aktive ohne
                    setEdit({ ...edit, ageClassCode: code, parentsEnabled: edit.id ? edit.parentsEnabled : isYouth(code) });
                  }}
                >
                  {(ages.data?.ageClasses ?? []).map((a) => (
                    <option value={a.code}>
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Mannschaft">
              {(id) => (
                <select id={id} class="select" value={edit.level} onChange={(e) => setEdit({ ...edit, level: Number((e.target as HTMLSelectElement).value) })}>
                  {[1, 2, 3, 4].map((l) => (
                    <option value={l}>{l}. Mannschaft</option>
                  ))}
                </select>
              )}
            </Field>
            <SwitchRow
              label="Eltern einbinden"
              sub="Eltern sagen für ihr Kind zu und ab, sind im Chat dabei und bekommen Benachrichtigungen. Ausschalten, wenn die Spieler selbst Verantwortung übernehmen, etwa in älteren Jugendmannschaften und bei den Aktiven."
              checked={edit.parentsEnabled}
              onChange={(v) => setEdit({ ...edit, parentsEnabled: v })}
            />
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!edit.name.trim() || !edit.ageClassCode}
              onClick={async () => {
                const body = { name: edit.name.trim(), ageClassCode: edit.ageClassCode, level: edit.level, parentsEnabled: edit.parentsEnabled };
                if (edit.id && edit.wasEnabled && !edit.parentsEnabled) {
                  const ok = await confirmDialog({
                    title: "Ohne Eltern weiterführen?",
                    message:
                      "Eltern sehen die Termine und den Chat dieser Mannschaft dann nicht mehr und können nicht mehr für ihr Kind antworten. Offene Elternlinks werden ungültig. Die Verknüpfungen bleiben erhalten und gelten wieder, wenn du Eltern später einschaltest.",
                    confirmLabel: "Ohne Eltern",
                  });
                  if (!ok) return;
                }
                if (edit.id) await api.patch(`/teams/${edit.id}`, body);
                else await api.post("/teams", body);
                toast("Gespeichert.");
                setEdit(null);
                invalidate("/teams");
                await refresh();
              }}
            >
              Speichern
            </Button>
            {edit.id ? (
              <Button
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Mannschaft löschen?", message: "Nur möglich, wenn niemand mehr zugeordnet ist.", confirmLabel: "Löschen", danger: true }))) return;
                  await api.del(`/teams/${edit.id}`);
                  setEdit(null);
                  invalidate("/teams");
                  await refresh();
                }}
              >
                Mannschaft löschen
              </Button>
            ) : null}
          </Sheet>
        ) : null}
        {coachesFor ? <CoachesSheet team={coachesFor} onClose={() => setCoachesFor(null)} /> : null}
      </main>
    </AdminOnly>
  );
}

function CoachesSheet({ team, onClose }: { team: { id: number; name: string }; onClose: () => void }) {
  const { refresh } = useSession();
  const persons = useQuery<{ persons: AdminPerson[] }>("/admin/persons");
  const [filter, setFilter] = useState("");
  const coaches = (persons.data?.persons ?? []).filter((p) => p.teams.some((t) => t.name === team.name && t.role === "coach"));
  const candidates = (persons.data?.persons ?? []).filter(
    (p) => !coaches.includes(p) && (!filter || personName(p.person).toLowerCase().includes(filter.toLowerCase())),
  );
  const update = async () => {
    invalidate("/admin/persons", "/teams");
    await persons.reload();
    await refresh();
  };
  return (
    <Sheet open onClose={onClose} title={`Trainer ${team.name}`}>
      {!persons.data ? <Spinner /> : null}
      <ul class="list">
        {coaches.map((c) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(c.person)}</span>
              <span class="sub">{c.hasAccount ? "hat Zugang" : "noch kein Zugang – Link unter Personen erzeugen"}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.del(`/teams/${team.id}/members/${c.person.id}?role=coach`);
                await update();
              }}
            >
              Entfernen
            </Button>
          </li>
        ))}
      </ul>
      {!coaches.length && persons.data ? <p class="muted">Noch kein Trainer zugeordnet.</p> : null}
      <TextField label="Person suchen" value={filter} onInput={setFilter} placeholder="Name" />
      <ul class="list" style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {candidates.slice(0, 30).map((p) => (
          <li class="list-row">
            <span class="main">
              <span class="title">{personName(p.person)}</span>
              <span class="sub">{p.teams.map((t) => `${t.name} (${roleLabel(t.role, t.isGroup)})`).join(", ") || (p.children ? `Elternteil von ${p.children}` : "ohne Mannschaft")}</span>
            </span>
            <Button
              size="sm"
              onClick={async () => {
                await api.post(`/teams/${team.id}/members`, { personId: p.person.id, role: "coach" });
                toast(`${p.person.firstName} ist Trainer der ${team.name}.`);
                await update();
              }}
            >
              Als Trainer
            </Button>
          </li>
        ))}
      </ul>
      <p class="small muted">Neue Trainer zuerst unter Personen anlegen.</p>
    </Sheet>
  );
}

// Personen ------------------------------------------------------------------------

export function AdminPersonsPage() {
  useDocumentTitle("Personen");
  const me = useMe();
  const { data, error, reload } = useQuery<{ persons: AdminPerson[] }>("/admin/persons");
  const [filter, setFilter] = useState("");
  const [team, setTeam] = useState("");
  const [year, setYear] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [activity, setActivity] = useState<ActivityFilter>("");
  const [sort, setSort] = useState<SortOrder>("name");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const persons = data?.persons ?? [];
  const selected = persons.find((p) => p.person.id === selectedId) ?? null;
  const teamNames = useMemo(() => [...new Set(persons.flatMap((p) => p.teams.map((t) => t.name)))].sort((a, b) => a.localeCompare(b, "de")), [data]);
  const years = useMemo(() => [...new Set(persons.map((p) => p.birthYear).filter((y): y is number => y != null))].sort((a, b) => b - a), [data]);
  const list = useMemo(
    () =>
      persons.filter((p) => {
        if (filter && !personName(p.person).toLowerCase().includes(filter.toLowerCase())) return false;
        if (year && (year === NONE ? p.birthYear != null : String(p.birthYear) !== year)) return false;
        // Mit Mannschaft: Mitglieder und Eltern von Mitgliedern
        const inTeam = (t: { name: string; role: string }) => !team || t.name === team;
        if (team === NONE) {
          if (p.teams.length || p.childTeams.length) return false;
        } else if (team && !p.teams.some(inTeam) && !p.childTeams.includes(team)) return false;
        if (role === "player" && !p.teams.some((t) => inTeam(t) && (t.role === "player" || t.role === "helper"))) return false;
        if (role === "coach" && !p.teams.some((t) => inTeam(t) && t.role === "coach")) return false;
        if (role === "parent" && !(team ? p.childTeams.includes(team) : p.childTeams.length || p.children)) return false;
        if (role === "none" && !withoutRole(p)) return false;
        if (activity === "stale" && !(p.hasAccount && (daysSinceSeen(p) ?? Infinity) > STALE_DAYS)) return false;
        if (activity === "never" && !(p.hasAccount && !p.lastSeenOn)) return false;
        if (activity === "noaccount" && p.hasAccount) return false;
        return true;
      }).sort((a, b) => (sort === "activity" ? activityRank(b) - activityRank(a) : 0)),
    [data, filter, team, year, role, activity, sort],
  );
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Personen" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          <div class="row-gap">
            <div style={{ flex: 1 }}>
              <TextField label="Suchen" value={filter} onInput={setFilter} placeholder="Name" />
            </div>
          </div>
          <div class="row-gap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field label="Mannschaft">
                {(id) => (
                  <select id={id} class="select" value={team} onChange={(e) => setTeam((e.target as HTMLSelectElement).value)}>
                    <option value="">Alle</option>
                    {teamNames.map((t) => (
                      <option value={t}>{t}</option>
                    ))}
                    <option value={NONE}>Ohne Mannschaft</option>
                  </select>
                )}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Jahrgang">
                {(id) => (
                  <select id={id} class="select" value={year} onChange={(e) => setYear((e.target as HTMLSelectElement).value)}>
                    <option value="">Alle</option>
                    {years.map((y) => (
                      <option value={String(y)}>{y}</option>
                    ))}
                    <option value={NONE}>Ohne Angabe</option>
                  </select>
                )}
              </Field>
            </div>
          </div>
          <Segmented
            label="Rolle"
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: "Alle" },
              { value: "player", label: "Spieler" },
              { value: "coach", label: "Trainer" },
              { value: "parent", label: "Eltern" },
              { value: "none", label: `Ohne Rolle${data ? ` (${persons.filter(withoutRole).length})` : ""}` },
            ]}
          />
          <div class="row-gap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field label="Aktivität">
                {(id) => (
                  <select id={id} class="select" value={activity} onChange={(e) => setActivity((e.target as HTMLSelectElement).value as ActivityFilter)}>
                    <option value="">Alle</option>
                    <option value="stale">Über {STALE_DAYS} Tage nicht aktiv</option>
                    <option value="never">Zugang nie benutzt</option>
                    <option value="noaccount">Kein Zugang</option>
                  </select>
                )}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Sortierung">
                {(id) => (
                  <select id={id} class="select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortOrder)}>
                    <option value="name">Name</option>
                    <option value="activity">Zuletzt aktiv</option>
                  </select>
                )}
              </Field>
            </div>
          </div>
          <Button icon="plus" onClick={() => setCreateOpen(true)}>
            Person anlegen
          </Button>
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data ? <Spinner /> : null}
          <p class="small muted">
            {list.length === persons.length ? `${list.length} Personen` : `${list.length} von ${persons.length} Personen`}
            {team || year || role !== "all" || filter || activity ? (
              <>
                {" · "}
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    setFilter("");
                    setTeam("");
                    setYear("");
                    setRole("all");
                    setActivity("");
                  }}
                >
                  Filter zurücksetzen
                </button>
              </>
            ) : null}
          </p>
          <ul class="list">
            {list.map((p) => (
              <li>
                <button type="button" class="list-row" onClick={() => setSelectedId(p.person.id)}>
                  <PersonAvatar personId={p.person.id} name={p.person.firstName} />
                  <span class="main">
                    <span class="title">
                      {personName(p.person)} {p.isAdmin ? <span class="badge">Admin</span> : null} {!p.isActive ? <span class="badge muted">Inaktiv</span> : null}
                    </span>
                    <span class="sub">
                      {[
                        // Ohne Mannschaft hilft der Jahrgang beim Einordnen
                        !p.teams.length && p.birthYear ? `Jg. ${p.birthYear}` : "",
                        ...p.teams.map((t) => `${t.name} ${t.role === "coach" ? "(Trainer)" : t.role === "helper" ? "(Aushilfe)" : ""}`.trim()),
                        p.children ? `Elternteil von ${p.children}` : "",
                        activityLabel(p),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <PersonAdminSheet p={selected} all={persons} selfId={me.person.id} onClose={() => setSelectedId(null)} onChanged={reload} />
        ) : null}
        {createOpen ? <CreatePersonSheet onClose={() => setCreateOpen(false)} onDone={reload} /> : null}
      </main>
    </AdminOnly>
  );
}

function CreatePersonSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  return (
    <Sheet open onClose={onClose} title="Person anlegen">
      <p class="muted">Zum Beispiel neue Trainerinnen und Trainer. Spieler legt der Trainer im Kader an.</p>
      <TextField label="Vorname" value={first} onInput={setFirst} maxLength={50} />
      <TextField label="Nachname" value={last} onInput={setLast} maxLength={50} />
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!first.trim()}
        onClick={async () => {
          await api.post("/admin/persons", { firstName: first.trim(), lastName: last.trim() || null });
          toast("Angelegt. Ordne die Person unter Mannschaften als Trainer zu.");
          onClose();
          onDone();
        }}
      >
        Anlegen
      </Button>
    </Sheet>
  );
}

/** Eltern und Kinder einer Person zuordnen oder lösen (Korrekturen durch Admins). */
function FamilySection({ p, all, onChanged }: { p: AdminPerson; all: AdminPerson[]; onChanged: () => void }) {
  const [picking, setPicking] = useState<"child" | "parent" | null>(null);
  const [search, setSearch] = useState("");
  const byId = new Map(all.map((x) => [x.person.id, x]));
  const describe = (x: AdminPerson) => [x.teams.map((t) => t.name).join(", "), x.birthYear ? `Jg. ${x.birthYear}` : ""].filter(Boolean).join(" · ");

  const link = async (guardianId: number, childId: number) => {
    await api.post("/admin/guardianships", { guardianId, childId });
    setPicking(null);
    setSearch("");
    toast("Zugeordnet.");
    onChanged();
  };
  const unlink = async (guardianId: number, childId: number) => {
    const g = byId.get(guardianId);
    const c = byId.get(childId);
    const ok = await confirmDialog({
      title: "Verknüpfung lösen?",
      message: `${g ? personName(g.person) : "Das Elternteil"} kann danach nicht mehr für ${c ? c.person.firstName : "das Kind"} handeln. Beide Personen bleiben erhalten.`,
      confirmLabel: "Lösen",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/admin/guardianships/${guardianId}/${childId}`);
    onChanged();
  };

  const candidates = all
    .filter((x) => x.person.id !== p.person.id && !p.childIds.includes(x.person.id) && !p.parentIds.includes(x.person.id))
    .filter((x) => !search || personName(x.person).toLowerCase().includes(search.toLowerCase()))
    // Für Kinder zuerst Spielerinnen und Spieler zeigen
    .sort((a, b) => (picking === "child" ? Number(b.teams.some((t) => t.role === "player")) - Number(a.teams.some((t) => t.role === "player")) : 0))
    .slice(0, 30);

  const row = (x: AdminPerson | undefined, onRemove: () => void) =>
    x ? (
      <li class="list-row">
        <span class="main">
          <span class="title">{personName(x.person)}</span>
          <span class="sub">{describe(x) || "ohne Mannschaft"}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Lösen
        </Button>
      </li>
    ) : null;

  return (
    <section class="stack-sm">
      <strong>Familie</strong>
      {p.childIds.length ? (
        <>
          <span class="small muted">Kinder</span>
          <ul class="list">{p.childIds.map((id) => row(byId.get(id), () => unlink(p.person.id, id)))}</ul>
        </>
      ) : null}
      {p.parentIds.length ? (
        <>
          <span class="small muted">Eltern</span>
          <ul class="list">{p.parentIds.map((id) => row(byId.get(id), () => unlink(id, p.person.id)))}</ul>
        </>
      ) : null}
      {picking ? (
        <div class="stack-sm">
          <TextField label={picking === "child" ? "Kind suchen" : "Elternteil suchen"} value={search} onInput={setSearch} placeholder="Name" />
          <ul class="list">
            {candidates.map((x) => (
              <li>
                <button
                  type="button"
                  class="list-row"
                  onClick={() => (picking === "child" ? link(p.person.id, x.person.id) : link(x.person.id, p.person.id))}
                >
                  <span class="main">
                    <span class="title">{personName(x.person)}</span>
                    <span class="sub">{describe(x) || "ohne Mannschaft"}</span>
                  </span>
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setPicking(null)}>
            Abbrechen
          </Button>
        </div>
      ) : (
        <div class="btn-row">
          <Button size="sm" icon="plus" onClick={() => setPicking("child")}>
            Kind zuordnen
          </Button>
          <Button size="sm" icon="plus" onClick={() => setPicking("parent")}>
            Elternteil zuordnen
          </Button>
        </div>
      )}
      <p class="small muted">Eltern sehen die Termine ihrer Kinder, sagen für sie zu und ab und sind im Mannschaftschat, sofern die Mannschaft Eltern einbindet.</p>
    </section>
  );
}

/** Mannschaften einer Person zuordnen oder entfernen (Admins). */
function TeamsSection({ p, onChanged }: { p: AdminPerson; onChanged: () => void }) {
  const teams = useQuery<{ teams: { id: number; name: string; kind: "team" | "group"; autoMembers: string | null }[] }>("/teams");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<"player" | "coach">("player");
  const [busy, setBusy] = useState(false);
  const all = teams.data?.teams ?? [];
  const idOf = new Map(all.map((t) => [t.name, t.id]));
  // Gruppen mit automatischen Mitgliedern (KiHaSL/JuHaSL) lassen sich nicht von Hand zuordnen
  const free = all.filter((t) => !t.autoMembers && !p.teams.some((m) => m.name === t.name && m.role === role));
  const selected = all.find((t) => t.id === Number(teamId || free[0]?.id));
  const selectedIsGroup = selected?.kind === "group";

  const done = () => {
    invalidate("/teams");
    onChanged();
  };
  const add = async () => {
    const id = Number(teamId || free[0]?.id);
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/teams/${id}/members`, { personId: p.person.id, role });
      toast(`${p.person.firstName} ist jetzt ${roleLabel(role, selectedIsGroup)} in ${all.find((t) => t.id === id)?.name ?? "der Mannschaft"}.`);
      setTeamId("");
      done();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (name: string, r: string, isGroup: boolean) => {
    const id = idOf.get(name);
    if (!id) return;
    const ok = await confirmDialog({
      title: `Aus ${name} entfernen?`,
      message: `${personName(p.person)} ist danach nicht mehr ${roleLabel(r, isGroup)} in ${name}. Die Person bleibt erhalten.`,
      confirmLabel: "Entfernen",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/teams/${id}/members/${p.person.id}?role=${r}`);
    done();
  };

  return (
    <section class="stack-sm">
      <strong>Mannschaften und Gruppen</strong>
      {p.teams.length ? (
        <ul class="list">
          {p.teams.map((m) => (
            <li class="list-row">
              <span class="main">
                <span class="title">{m.name}</span>
                <span class="sub">{m.isGroup ? `Gruppe · ${roleLabel(m.role, true)}` : roleLabel(m.role, false)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => remove(m.name, m.role, m.isGroup)}>
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted">Noch keiner Mannschaft zugeordnet.</p>
      )}
      {teams.error ? <ErrorBox error={teams.error} /> : null}
      {all.length ? (
        <>
          <Segmented
            label="Rolle"
            value={role}
            onChange={setRole}
            options={[
              { value: "player", label: "Spieler / Mitglied" },
              { value: "coach", label: "Trainer / Verantw." },
            ]}
          />
          {free.length ? (
            <>
              <Field label="Mannschaft oder Gruppe">
                {(id) => (
                  <select id={id} class="select" value={teamId || String(free[0]!.id)} onChange={(e) => setTeamId((e.target as HTMLSelectElement).value)}>
                    {free.map((t) => (
                      <option value={t.id}>{t.kind === "group" ? `${t.name} (Gruppe)` : t.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Button icon="plus" disabled={busy} onClick={add}>
                Als {roleLabel(role, selectedIsGroup)} zuordnen
              </Button>
            </>
          ) : (
            <p class="small muted">Überall schon {roleLabel(role, false)}.</p>
          )}
        </>
      ) : null}
      <p class="small muted">Aushilfen tragen die Trainer in ihrer Mannschaft ein.</p>
    </section>
  );
}

/** Angaben einer Person korrigieren oder ergänzen (nur Vorname, Nachname, Jahrgang). */
function PersonDataSection({ p, onChanged }: { p: AdminPerson; onChanged: () => void }) {
  const [firstName, setFirstName] = useState(p.person.firstName);
  const [lastName, setLastName] = useState(p.person.lastName ?? "");
  const [birthYear, setBirthYear] = useState(p.birthYear ? String(p.birthYear) : "");
  const [busy, setBusy] = useState(false);
  const year = birthYear.trim() ? Number(birthYear.trim()) : null;
  const yearInvalid = year != null && (!Number.isInteger(year) || year < 1930 || year > new Date().getFullYear());
  const changed = firstName.trim() !== p.person.firstName || (lastName.trim() || null) !== (p.person.lastName ?? null) || year !== p.birthYear;
  return (
    <section class="stack-sm">
      <strong>Angaben</strong>
      <div class="grid-2">
        <TextField label="Vorname" value={firstName} onInput={setFirstName} maxLength={50} />
        <TextField label="Nachname" value={lastName} onInput={setLastName} maxLength={50} />
      </div>
      <TextField
        label="Jahrgang"
        value={birthYear}
        onInput={setBirthYear}
        inputMode="numeric"
        maxLength={4}
        placeholder="z. B. 2015"
        error={yearInvalid ? "Bitte ein Jahr wie 2015 eingeben." : null}
      />
      <Button
        disabled={busy || !changed || !firstName.trim() || yearInvalid}
        onClick={async () => {
          setBusy(true);
          try {
            await api.patch(`/persons/${p.person.id}`, { firstName: firstName.trim(), lastName: lastName.trim() || null, birthYear: year });
            toast("Angaben gespeichert.");
            onChanged();
          } finally {
            setBusy(false);
          }
        }}
      >
        Angaben speichern
      </Button>
    </section>
  );
}

/** Dauerhaft löschen, mit Übersicht der Folgen und Namensbestätigung. */
function DeletePersonSection({ p, all, onDeleted }: { p: AdminPerson; all: AdminPerson[]; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = personName(p.person);
  // Eltern ohne weiteres Kind und ohne eigene Rolle verschwinden mit (wie auf dem Server)
  const orphanParents = p.parentIds
    .map((id) => all.find((x) => x.person.id === id))
    .filter((x): x is AdminPerson => !!x && !x.isAdmin && !x.teams.length && x.childIds.length === 1 && !x.parentIds.length);
  const effects = [
    p.hasAccount ? "der Zugang mit allen Geräten und Benachrichtigungen" : "",
    p.teams.length ? `die Zuordnung zu ${p.teams.map((t) => t.name).join(", ")}` : "",
    "alle Zusagen, Absagen und Nominierungen",
    p.childIds.length ? "die Verknüpfung zu den Kindern" : "",
    p.parentIds.length ? "die Verknüpfung zu den Eltern" : "",
    orphanParents.length ? `${orphanParents.map((x) => personName(x.person)).join(", ")} (Elternteil ohne weiteres Kind)` : "",
    "das Profilbild",
  ].filter(Boolean);
  return (
    <section class="stack-sm">
      <strong>Löschen</strong>
      {!open ? (
        <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>
          Person dauerhaft löschen
        </Button>
      ) : (
        <div class="stack-sm">
          <p class="small">Das lässt sich nicht rückgängig machen. Gelöscht werden {name} und:</p>
          <ul class="small" style={{ margin: 0, paddingLeft: "20px" }}>
            {effects.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
          <p class="small muted">Chatnachrichten bleiben stehen und erscheinen als „Gelöschte Person“. Wer den Verein nur verlässt, besser über den Austritt in der Mannschaft austragen.</p>
          <TextField label={`Zur Bestätigung „${name}“ eintippen`} value={typed} onInput={setTyped} />
          <div class="btn-row">
            <Button
              variant="danger-solid"
              icon="trash"
              disabled={busy || typed.trim() !== name}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.del(`/admin/persons/${p.person.id}`);
                  toast(`${name} wurde gelöscht.`);
                  onDeleted();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Endgültig löschen
            </Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setTyped(""); }}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function PersonAdminSheet({ p, all, selfId, onClose, onChanged }: { p: AdminPerson; all: AdminPerson[]; selfId: number; onClose: () => void; onChanged: () => void }) {
  const [email, setEmail] = useState(p.adminEmail ?? "");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  return (
    <Sheet open onClose={onClose} title={personName(p.person)}>
      <p class="muted">
        {p.teams.map((t) => `${t.name} (${roleLabel(t.role, t.isGroup)})`).join(", ") || "Keine Mannschaft"}
        {p.children ? ` · Elternteil von ${p.children}` : ""}
      </p>
      <p class="small muted">
        {p.lastSeenOn && p.hasAccount ? `Zuletzt aktiv: ${fullDate(p.lastSeenOn)} (${activityLabel(p).replace(" aktiv", "")})` : activityLabel(p)}
      </p>
      <PersonDataSection key={p.person.id} p={p} onChanged={onChanged} />
      <TeamsSection p={p} onChanged={onChanged} />
      <section class="stack-sm">
        <strong>Zugang</strong>
        <p class="small muted">{p.hasAccount ? "Hat einen Zugang." : "Hat noch keinen Zugang."} Ein persönlicher Einmal-Link richtet einen neuen Passkey ein und meldet dabei die bisherigen Geräte ab.</p>
        <Button
          icon="link"
          onClick={async () => {
            setLink(await api.post<{ url: string; expiresAt: string }>(`/persons/${p.person.id}/personal-link`, {}));
          }}
        >
          Persönlichen Link erzeugen
        </Button>
        {link ? (
          <div class="stack-sm">
            <QrLink url={link.url} />
            <div class="url-box">{link.url}</div>
            <div class="btn-row">
              <Button variant="primary" icon="share" onClick={() => shareLink(clubName(), `Dein persönlicher Zugang zur App ${clubName()}`, link.url)}>
                Teilen
              </Button>
              <Button icon="copy" onClick={() => copyText(link.url)}>
                Kopieren
              </Button>
            </div>
            <p class="small muted">Gültig bis {fullDate(isoToLocalDate(link.expiresAt))}, nur einmal verwendbar.</p>
          </div>
        ) : null}
      </section>
      <AdminAvatar personId={p.person.id} name={personName(p.person)} />
      <SwitchRow
        label="KiHaSL/JuHaSL"
        sub="Darf bei allen Jugend-Heimspielen F bis C als Schiedsrichter eingeteilt werden."
        checked={p.isReferee}
        onChange={async (on) => {
          if (on) await api.put(`/admin/referees/${p.person.id}`);
          else await api.del(`/admin/referees/${p.person.id}`);
          toast(on ? `${p.person.firstName} ist als KiHaSL/JuHaSL freigeschaltet.` : `${p.person.firstName} ist kein KiHaSL/JuHaSL mehr.`);
          onChanged();
        }}
      />
      <SwitchRow
        label="Ordentliches Mitglied"
        sub="Nur für Admins sichtbar. Ordentliche Mitglieder können Sondertermine mitorganisieren und Dienste mit „Wer hilft: Mitglieder“ übernehmen."
        checked={p.isClubMember}
        onChange={async (on) => {
          if (on) await api.put(`/admin/club-members/${p.person.id}`);
          else await api.del(`/admin/club-members/${p.person.id}`);
          toast(on ? `${p.person.firstName} ist ordentliches Mitglied.` : `${p.person.firstName} ist kein ordentliches Mitglied mehr.`);
          onChanged();
        }}
      />
      <FamilySection p={p} all={all} onChanged={onChanged} />
      <section class="stack-sm">
        <strong>Admin</strong>
        {p.isAdmin ? (
          <>
            <p class="small muted">Admin{p.adminEmail ? ` · ${p.adminEmail}` : ""}</p>
            {p.person.id !== selfId ? (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Admin-Rechte entziehen?", message: `${personName(p.person)} ist danach kein Admin mehr.`, confirmLabel: "Entziehen", danger: true }))) return;
                  await api.patch(`/admin/persons/${p.person.id}`, { isAdmin: false });
                  onClose();
                  onChanged();
                }}
              >
                Admin-Rechte entziehen
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <TextField label="E-Mail (nur für Admins)" type="email" value={email} onInput={setEmail} hint="Dient nur als Kennung des Admins. Die Adresse für die Anmeldung legt jede Person selbst im Profil fest." />
            <Button
              onClick={async () => {
                await api.patch(`/admin/persons/${p.person.id}`, { isAdmin: true, adminEmail: email.trim() || null });
                toast(`${p.person.firstName} ist jetzt Admin.`);
                onClose();
                onChanged();
              }}
            >
              Zum Admin machen
            </Button>
          </>
        )}
      </section>
      {p.person.id !== selfId ? <DeletePersonSection p={p} all={all} onDeleted={() => { onClose(); onChanged(); }} /> : null}
    </Sheet>
  );
}

// Altersklassen --------------------------------------------------------------------

export function AdminAgeClassesPage() {
  const { query } = useLocation();
  const seasonId = query.season;
  useDocumentTitle("Altersklassen");
  const path = seasonId ? `/seasons/${seasonId}/age-classes` : "/age-classes";
  const { data, error, reload } = useQuery<{ season?: { name: string } | null; ageClasses: AgeClass[] }>(path);
  const [rows, setRows] = useState<AgeClass[] | null>(null);
  useEffect(() => {
    if (data) setRows(data.ageClasses);
  }, [data]);

  const update = (i: number, patch: Partial<AgeClass>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Altersklassen" kicker={seasonId ? "Kommende Saison" : (data?.season?.name ?? "Laufende Saison")} back={seasonId ? "/verwaltung/saisonwechsel" : "/verwaltung"} />
        <div class="content">
          <Notice>
            Die Jahrgänge legt der Verband pro Saison fest. Bitte mit den Durchführungsbestimmungen abgleichen. „Rang“ ordnet die Klassen von jung nach alt und bestimmt,
            welches die nächsthöhere Jugend ist.
          </Notice>
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!rows ? <Spinner /> : null}
          {rows ? (
            <div class="card scroll-x">
              <table class="table">
                <thead>
                  <tr>
                    <th>Kürzel</th>
                    <th>Name</th>
                    <th>Geschl.</th>
                    <th>Rang</th>
                    <th>Jugend</th>
                    <th>Jg. von</th>
                    <th>Jg. bis</th>
                    <th>
                      <span class="sr-only">Entfernen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr>
                      <td>
                        <input class="input" style={{ width: "64px" }} value={r.code} aria-label="Kürzel" onInput={(e) => update(i, { code: (e.target as HTMLInputElement).value })} />
                      </td>
                      <td>
                        <input class="input" style={{ minWidth: "160px" }} value={r.name} aria-label="Name" onInput={(e) => update(i, { name: (e.target as HTMLInputElement).value })} />
                      </td>
                      <td>
                        <select class="select" style={{ minHeight: "40px", width: "64px" }} value={r.gender} aria-label="Geschlecht" onChange={(e) => update(i, { gender: (e.target as HTMLSelectElement).value as AgeClass["gender"] })}>
                          <option value="w">w</option>
                          <option value="m">m</option>
                          <option value="x">gem.</option>
                        </select>
                      </td>
                      <td>
                        <input class="input" style={{ width: "52px" }} inputMode="numeric" value={r.rank} aria-label="Rang" onInput={(e) => update(i, { rank: Number((e.target as HTMLInputElement).value) || 0 })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.isYouth} aria-label="Jugend" onChange={(e) => update(i, { isYouth: (e.target as HTMLInputElement).checked })} style={{ width: "22px", height: "22px" }} />
                      </td>
                      <td>
                        <input class="input" style={{ width: "72px" }} inputMode="numeric" value={r.birthYearMin ?? ""} aria-label="Ältester Jahrgang" onInput={(e) => update(i, { birthYearMin: num((e.target as HTMLInputElement).value) })} />
                      </td>
                      <td>
                        <input class="input" style={{ width: "72px" }} inputMode="numeric" value={r.birthYearMax ?? ""} aria-label="Jüngster Jahrgang" onInput={(e) => update(i, { birthYearMax: num((e.target as HTMLInputElement).value) })} />
                      </td>
                      <td>
                        <button type="button" class="icon-btn" aria-label={`${r.name} entfernen`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                          <Icon name="trash" size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows ? (
            <>
              <Button icon="plus" onClick={() => setRows([...rows, { code: "", name: "", gender: "w", rank: 1, isYouth: true, birthYearMin: null, birthYearMax: null }])}>
                Zeile hinzufügen
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={async () => {
                  await api.put(path, { ageClasses: rows.map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() })) });
                  toast("Altersklassen gespeichert.");
                  invalidate(path, "/teams");
                }}
              >
                Speichern
              </Button>
            </>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}

// Ferien --------------------------------------------------------------------------

interface HolidayPeriod {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  imported: boolean;
  /** Verknüpfte Ferienpläne, die bei Änderungen mitziehen */
  plans: number;
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function AdminHolidaysPage() {
  useDocumentTitle("Ferien");
  const { data, error, reload } = useQuery<{ periods: HolidayPeriod[]; source: string }>("/holidays");
  const [editing, setEditing] = useState<HolidayPeriod | "new" | null>(null);
  const today = todayLocal();
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Ferien" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          <p class="muted">
            Ferienzeiträume mit Namen. Jeder lässt sich ändern oder löschen. Ferienpläne der Mannschaften, die mit einem Zeitraum verknüpft sind, ziehen bei Änderungen
            mit. Die Schulferien Baden-Württemberg werden beim Saisonwechsel übernommen (Quelle: {data?.source ?? "OpenHolidays API"}).
          </p>
          <Button icon="plus" onClick={() => setEditing("new")}>
            Zeitraum hinzufügen
          </Button>
          <section class="stack-sm" aria-label="Ferienzeiträume">
            {!data && !error ? <Spinner /> : null}
            {data && !data.periods.length ? <Empty title="Keine Ferien">Lege Zeiträume an oder übernimm sie beim nächsten Saisonwechsel.</Empty> : null}
            <ul class="list">
              {(data?.periods ?? []).map((p) => (
                <li>
                  <button type="button" class="list-row" style={{ opacity: p.endsOn < today ? 0.6 : 1 }} onClick={() => setEditing(p)}>
                    <Icon name="sun" size={20} />
                    <span class="main">
                      <span class="title">{p.name}</span>
                      <span class="sub">
                        {fullDate(p.startsOn)} – {fullDate(p.endsOn)} · {dayCount(p.startsOn, p.endsOn)} {dayCount(p.startsOn, p.endsOn) === 1 ? "Tag" : "Tage"}
                        {p.plans ? ` · ${p.plans} ${p.plans === 1 ? "Ferienplan" : "Ferienpläne"}` : ""}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
        {editing ? (
          <HolidaySheet
            period={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              invalidate("/holidays", "/events");
              await reload();
            }}
          />
        ) : null}
      </main>
    </AdminOnly>
  );
}

function HolidaySheet({ period, onClose, onDone }: { period: HolidayPeriod | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(period?.name ?? "");
  const [from, setFrom] = useState(period?.startsOn ?? "");
  const [to, setTo] = useState(period?.endsOn ?? "");
  const valid = name.trim() && from && to && from <= to;
  return (
    <Sheet open onClose={onClose} title={period ? period.name : "Neuer Ferienzeitraum"}>
      <TextField label="Name" value={name} onInput={setName} maxLength={60} placeholder="z. B. Fastnachtsferien" />
      <div class="grid-2">
        <Field label="Von">{(id) => <input id={id} class="input" type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />}</Field>
        <Field label="Bis">{(id) => <input id={id} class="input" type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />}</Field>
      </div>
      {from && to && from > to ? <p class="small warn-text">Das Ende muss nach dem Beginn liegen.</p> : null}
      {period?.plans ? (
        <p class="small muted">
          {period.plans === 1 ? "Ein Ferienplan ist" : `${period.plans} Ferienpläne sind`} mit diesem Zeitraum verknüpft und übernehmen neue Daten automatisch.
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!valid}
        onClick={async () => {
          const body = { name: name.trim(), startsOn: from, endsOn: to };
          if (period) await api.patch(`/holidays/${period.id}`, body);
          else await api.post("/holidays", body);
          toast(period ? "Gespeichert. Trainings sind angepasst." : "Ferienzeitraum angelegt.");
          onDone();
        }}
      >
        Speichern
      </Button>
      {period ? (
        <Button
          variant="danger"
          block
          onClick={async () => {
            const ok = await confirmDialog({
              title: `${period.name} löschen?`,
              message: period.plans
                ? `Verknüpfte Ferienpläne bleiben mit ihren Daten bestehen, ziehen aber nicht mehr mit.`
                : "Der Zeitraum wird aus der Liste entfernt.",
              confirmLabel: "Löschen",
              danger: true,
            });
            if (!ok) return;
            await api.del(`/holidays/${period.id}`);
            toast("Ferienzeitraum gelöscht.");
            onDone();
          }}
        >
          Löschen
        </Button>
      ) : null}
    </Sheet>
  );
}

// Orte --------------------------------------------------------------------------

export function AdminLocationsPage() {
  useDocumentTitle("Trainingsorte");
  const { data, error, reload } = useQuery<{ locations: (LocationRef & { inUse: boolean })[] }>("/locations?all=1");
  const [edit, setEdit] = useState<(LocationRef & { inUse: boolean }) | null>(null);
  const groups: { kind: LocationRef["kind"]; title: string }[] = [
    { kind: "hall", title: "Vereinshallen" },
    { kind: "custom", title: "Weitere Trainingsorte" },
    { kind: "external", title: "Gegnerische Hallen (aus dem Spielplan)" },
  ];
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Trainingsorte" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          {error ? <ErrorBox error={error} onRetry={reload} /> : null}
          {!data ? <Spinner /> : null}
          {groups.map((g) => {
            const items = (data?.locations ?? []).filter((l) => l.kind === g.kind);
            if (!items.length) return null;
            return (
              <section class="stack-sm" aria-label={g.title}>
                <h2 class="section-title">{g.title}</h2>
                <ul class="list">
                  {items.map((l) => (
                    <li>
                      <button type="button" class="list-row" onClick={() => setEdit(l)}>
                        <Icon name="pin" size={20} />
                        <span class="main">
                          <span class="title">{l.name}</span>
                          <span class="sub">{l.address ?? "Adresse fehlt"}</span>
                        </span>
                        <Icon name="edit" size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {edit ? <LocationSheet loc={edit} onClose={() => setEdit(null)} onDone={reload} /> : null}
      </main>
    </AdminOnly>
  );
}

function LocationSheet({ loc, onClose, onDone }: { loc: LocationRef & { inUse: boolean }; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(loc.name);
  const [address, setAddress] = useState(loc.address ?? "");
  const [mapUrl, setMapUrl] = useState(loc.mapUrl ?? "");
  return (
    <Sheet open onClose={onClose} title="Ort bearbeiten">
      <TextField label="Name" value={name} onInput={setName} maxLength={80} />
      <TextField label="Adresse" value={address} onInput={setAddress} maxLength={200} />
      <TextField label="Kartenlink (optional)" value={mapUrl} onInput={setMapUrl} type="url" hint="https-Link, z. B. zu OpenStreetMap" />
      <Button
        variant="primary"
        size="lg"
        block
        onClick={async () => {
          await api.patch(`/locations/${loc.id}`, { name: name.trim(), address: address.trim() || null, mapUrl: mapUrl.trim() || null });
          invalidate("/locations", "/events");
          toast("Gespeichert.");
          onClose();
          onDone();
        }}
      >
        Speichern
      </Button>
      {loc.kind !== "hall" ? (
        <Button
          variant="ghost"
          icon="trash"
          disabled={loc.inUse}
          onClick={async () => {
            await api.del(`/locations/${loc.id}`);
            invalidate("/locations");
            onClose();
            onDone();
          }}
        >
          {loc.inUse ? "Wird in einem Plan verwendet" : "Ort löschen"}
        </Button>
      ) : null}
    </Sheet>
  );
}

/** Kommende, von Hand angelegte Termine anderer Mannschaften (eigene stehen unter Termine). */
export function AdminExtraEventsPage() {
  useDocumentTitle("Sondertermine und Spiele");
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title="Sondertermine und Spiele" kicker="Verwaltung" back="/verwaltung" />
        <div class="content">
          <p class="small muted">
            Kommende Sondertermine und Spiele ohne handball4all aller Mannschaften. Termine, die du ohnehin unter Termine siehst, stehen nicht hier. Antippen öffnet den
            Termin, dort kannst du ihn bearbeiten, absagen oder löschen.
          </p>
          <a class="btn btn-primary" href="/verwaltung/termin-neu">
            <Icon name="plus" size={18} />
            Sondertermin anlegen
          </a>
          <p class="small muted">Spiele ohne handball4all legst du in der Mannschaft an (Team → Termin anlegen).</p>
          <ExtraEventList path="/admin/extra-events" empty="Alle kommenden Sondertermine und Spiele stehen in deiner Terminübersicht." />
        </div>
      </main>
    </AdminOnly>
  );
}
